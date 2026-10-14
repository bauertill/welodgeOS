import { TRPCError } from "@trpc/server";
import { z } from "zod";

import { parseDay } from "~/lib/dates";
import { formatDate } from "~/lib/format";
import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";
import { applyInventoryChange } from "~/server/api/routers/inventory";
import { rectangles } from "~/server/api/routers/sales";
import { ACQUIRE } from "~/server/acquire";
import { logAudit } from "~/server/audit";
import { deliverImmediate, notify } from "~/server/notify";

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Give the date");

/**
 * The acquire task's working parts (doc §4.11, 2026-10-14): what was sold at
 * the hotel, its quote and whose agreement it is on, the hotel's contract
 * made from that quote — and, once the hotel signs, the rooms bought under it
 * and the task done.
 */
export const acquireRouter = createTRPCRouter({
  forTask: protectedProcedure.input(z.object({ taskId: z.string() })).query(async ({ ctx, input }) => {
    const task = await ctx.db.task.findUniqueOrThrow({
      where: { id: input.taskId },
      select: { id: true, status: true, salesRequestId: true, propertyId: true, eventId: true, type: { select: { name: true } } },
    });
    if (task.type?.name !== ACQUIRE || !task.salesRequestId || !task.propertyId || !task.eventId) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "This is not an acquire task." });
    }
    const { salesRequestId, propertyId, eventId } = task;
    const [request, offers, entry, contracts, nights] = await Promise.all([
      ctx.db.salesRequest.findUniqueOrThrow({ where: { id: salesRequestId }, select: { id: true, client: { select: { name: true } } } }),
      ctx.db.offer.findMany({
        where: { salesRequestId, status: { in: ["SIGNED", "TRUSTED"] } },
        select: {
          status: true,
          currency: true,
          contract: { select: { id: true, name: true, signedOn: true } },
          lines: {
            where: { category: { propertyId } },
            orderBy: { position: "asc" },
            select: { id: true, rooms: true, checkIn: true, checkOut: true, rateCents: true, category: { select: { name: true } } },
          },
        },
      }),
      ctx.db.scoutingEntry.findFirst({ where: { eventId, propertyId }, select: { id: true } }),
      ctx.db.contract.findMany({
        where: { party: "SUPPLIER", propertyId, eventId },
        orderBy: { createdAt: "desc" },
        select: { id: true, name: true, eventId: true, signedOn: true, documentUrl: true, salesRequestId: true, totalCents: true, currency: true },
      }),
      ctx.db.roomNight.groupBy({
        by: ["acquisitionState"],
        where: { salesRequestId, salesState: "SOLD", slot: { category: { propertyId } } },
        _count: true,
      }),
    ]);
    const quotes = entry
      ? await ctx.db.quotation.findMany({
          where: { scoutingEntryId: entry.id, OR: [{ salesRequestId }, { salesRequestId: null }] },
          orderBy: { createdAt: "desc" },
          select: { id: true, name: true, status: true, agreementOn: true, currency: true, receivedOn: true, contractId: true, salesRequestId: true },
        })
      : [];
    return {
      status: task.status,
      request,
      sold: offers.flatMap((offer) => offer.lines.map((line) => ({ ...line, currency: offer.currency }))),
      clientContract: offers[0]?.contract ?? null,
      trusted: offers.some((offer) => offer.status === "TRUSTED"),
      quotes,
      // This request's hotel contracts first.
      contracts: contracts.sort((a, b) => Number(b.salesRequestId === salesRequestId) - Number(a.salesRequestId === salesRequestId)),
      nights: Object.fromEntries(nights.map((group) => [group.acquisitionState, group._count])) as Partial<Record<string, number>>,
    };
  }),

  /**
   * The hotel signed (doc §4.11): its contract is marked signed, the client's
   * rooms at the hotel are bought under it — at the quote's rates — and the
   * acquire task is done.
   */
  hotelSigned: protectedProcedure
    .input(z.object({ taskId: z.string(), contractId: z.string(), signedOn: day, documentUrl: z.string().trim().max(2000) }))
    .mutation(async ({ ctx, input }) => {
      await ctx.db.$transaction(
        async (tx) => {
          const actorId = ctx.session.user.id;
          const task = await tx.task.findUniqueOrThrow({
            where: { id: input.taskId },
            select: { id: true, title: true, status: true, salesRequestId: true, propertyId: true, eventId: true, requestedById: true, assignees: { select: { id: true } } },
          });
          if (!task.salesRequestId || !task.propertyId || !task.eventId) throw new TRPCError({ code: "BAD_REQUEST", message: "This is not an acquire task." });
          const contract = await tx.contract.findUniqueOrThrow({
            where: { id: input.contractId },
            include: { quotations: { include: { lines: true } } },
          });
          if (contract.party !== "SUPPLIER" || contract.propertyId !== task.propertyId || contract.eventId !== task.eventId) {
            throw new TRPCError({ code: "BAD_REQUEST", message: "That contract is not this hotel's for this event." });
          }
          const signedOn = parseDay(input.signedOn);
          await tx.contract.update({
            where: { id: contract.id },
            data: { signedOn, documentUrl: input.documentUrl || contract.documentUrl, salesRequestId: contract.salesRequestId ?? task.salesRequestId },
          });
          // What we pay a night, per room type, as quoted.
          const rate = new Map(contract.quotations.flatMap((quote) => quote.lines.map((line) => [line.categoryId, { cents: line.rateCents, currency: quote.currency }] as const)));
          const toBuy = await tx.roomNight.findMany({
            where: { salesRequestId: task.salesRequestId, salesState: "SOLD", acquisitionState: { not: "BOUGHT" }, slot: { category: { propertyId: task.propertyId } } },
            select: { slotId: true, date: true, acquisitionState: true, slot: { select: { categoryId: true } } },
          });
          let bought = 0;
          for (const categoryId of new Set(toBuy.map((night) => night.slot.categoryId))) {
            const these = toBuy.filter((night) => night.slot.categoryId === categoryId);
            for (const rect of rectangles(these)) {
              const price = rate.get(categoryId);
              const outcome = await applyInventoryChange(tx, actorId, {
                eventId: task.eventId,
                slotIds: rect.slotIds,
                checkIn: rect.checkIn,
                checkOut: rect.checkOut,
                action: "BUY",
                acquisitionContractId: contract.id,
                ...(price && { buyPriceCents: price.cents, buyCurrency: price.currency }),
                reason: "The hotel signed its contract",
              });
              bought += outcome.nights;
            }
          }
          await tx.task.update({ where: { id: task.id }, data: { status: "DONE", doneAt: task.status === "DONE" ? undefined : new Date() } });
          await logAudit(tx, {
            actorId,
            entity: "Task",
            entityId: task.id,
            summary: `Done — the hotel signed on ${formatDate(signedOn)}: ${bought} room-nights bought`,
          });
          await logAudit(tx, { actorId, entity: "Contract", entityId: contract.id, summary: `Signed by the hotel on ${formatDate(signedOn)}` });
          await logAudit(tx, {
            actorId,
            entity: "SalesRequest",
            entityId: task.salesRequestId,
            summary: `Hotel contract signed: ${contract.name} — ${bought} room-nights bought`,
          });
          const request = await tx.salesRequest.findUniqueOrThrow({ where: { id: task.salesRequestId }, select: { ownerId: true } });
          await notify(tx, {
            to: [request.ownerId, task.requestedById],
            actorId,
            kind: "TASK_STATUS",
            title: `${task.title}: the hotel signed — the rooms are bought`,
            link: `/tasks/${task.id}`,
            taskId: task.id,
          });
        },
        { timeout: 60_000 },
      );
      await deliverImmediate(ctx.db);
    }),
});
