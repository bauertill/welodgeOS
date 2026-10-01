import { QuotationStatus, type Prisma } from "generated/prisma";
import { TRPCError } from "@trpc/server";
import { z } from "zod";

import { nightsBetween, parseDay } from "~/lib/dates";
import { formatDate, formatMoney } from "~/lib/format";
import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";
import { logAudit } from "~/server/audit";

/**
 * Quotations (doc §3.10): what a hotel offered for an event, kept apart from
 * what the hotel is. A hotel can send several — different periods, different
 * numbers of rooms, different groups — so each is a scenario of its own, made
 * of lines: rooms of one category, for one period, at one rate. Totals are
 * worked out when read; an accepted quotation becomes the supplier contract.
 */

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Give the date");
const optionalDay = z.string().regex(/^(\d{4}-\d{2}-\d{2})?$/, "That date does not look right");
const blank = (value: string | undefined) => (value?.trim() ? value.trim() : null);
const toDay = (value: string | undefined) => (value ? parseDay(value) : null);

const lineInput = z.object({
  categoryId: z.string(),
  checkIn: day,
  checkOut: day,
  rooms: z.number().int().min(1, "Each line needs at least one room").max(10_000),
  rateCents: z.number().int().min(0),
  occupancy: z.number().int().min(1).max(20).nullable(),
});

const quotationInput = z.object({
  name: z.string().trim().min(1, "Give the quotation a name — the group or scenario, like Austria House staff").max(300),
  receivedOn: optionalDay,
  validUntil: optionalDay,
  persons: z.number().int().min(0).max(100_000).nullable(),
  currency: z.string().length(3),
  paymentTerms: z.string().max(5000),
  cancellationTerms: z.string().max(5000),
  ratesInclude: z.string().max(2000),
  documentUrl: z
    .string()
    .trim()
    .max(2000)
    .refine((value) => value === "" || /^https?:\/\//.test(value), "Paste the whole link, starting with https://"),
  notes: z.string().max(5000),
  lines: z.array(lineInput).min(1, "Add at least one line — rooms of a category, for a period, at a rate.").max(200),
});

const include = {
  lines: {
    orderBy: [{ position: "asc" }, { checkIn: "asc" }],
    include: { category: { select: { id: true, name: true } } },
  },
  contract: { select: { id: true, name: true, eventId: true } },
  addedBy: { select: { name: true, email: true } },
} satisfies Prisma.QuotationInclude;

type Loaded = Prisma.QuotationGetPayload<{ include: typeof include }>;

/** What a quotation comes to, line by line and in all — worked out, never stored. */
function withTotals(quotation: Loaded) {
  const lines = quotation.lines.map((line) => {
    const nights = nightsBetween(line.checkIn, line.checkOut);
    return { ...line, nights, roomNights: nights * line.rooms, totalCents: nights * line.rooms * line.rateCents };
  });
  const starts = lines.map((line) => line.checkIn.getTime());
  const ends = lines.map((line) => line.checkOut.getTime());
  return {
    ...quotation,
    lines,
    roomNights: lines.reduce((sum, line) => sum + line.roomNights, 0),
    totalCents: lines.reduce((sum, line) => sum + line.totalCents, 0),
    from: starts.length ? new Date(Math.min(...starts)) : null,
    to: ends.length ? new Date(Math.max(...ends)) : null,
  };
}

/** Once a quotation has become a contract, it stays accepted and on the board. */
async function refuseOnceContracted(db: Prisma.TransactionClient, id: string, refuse: boolean) {
  if (!refuse) return;
  const quotation = await db.quotation.findUniqueOrThrow({ where: { id }, select: { contractId: true } });
  if (quotation.contractId) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "This quotation has become a contract, so it stays accepted. Change the contract instead." });
  }
}

export const quotationRouter = createTRPCRouter({
  /** A hotel's quotations for an event, newest first, with their totals. */
  forEntry: protectedProcedure.input(z.object({ scoutingEntryId: z.string() })).query(async ({ ctx, input }) => {
    const quotations = await ctx.db.quotation.findMany({
      where: { scoutingEntryId: input.scoutingEntryId },
      orderBy: [{ createdAt: "desc" }],
      include,
    });
    return quotations.map(withTotals);
  }),

  /** Add a quotation, or change one — its lines are replaced by the ones given. */
  save: protectedProcedure
    .input(z.object({ scoutingEntryId: z.string(), id: z.string().optional(), quotation: quotationInput }))
    .mutation(({ ctx, input }) =>
      ctx.db.$transaction(async (tx) => {
        const entry = await tx.scoutingEntry.findUniqueOrThrow({
          where: { id: input.scoutingEntryId },
          select: { propertyId: true, property: { select: { categories: { select: { id: true } } } } },
        });
        const own = new Set(entry.property.categories.map((category) => category.id));
        const { lines, ...fields } = input.quotation;
        for (const line of lines) {
          if (!own.has(line.categoryId)) {
            throw new TRPCError({ code: "BAD_REQUEST", message: "Every line must be one of this hotel's own room categories." });
          }
          if (line.checkOut <= line.checkIn) {
            throw new TRPCError({ code: "BAD_REQUEST", message: "Each line's check-out must be after its check-in." });
          }
        }
        const data = {
          name: fields.name,
          receivedOn: toDay(fields.receivedOn),
          validUntil: toDay(fields.validUntil),
          persons: fields.persons,
          currency: fields.currency,
          paymentTerms: blank(fields.paymentTerms),
          cancellationTerms: blank(fields.cancellationTerms),
          ratesInclude: blank(fields.ratesInclude),
          documentUrl: blank(fields.documentUrl),
          notes: blank(fields.notes),
        };
        const before = input.id ? await tx.quotation.findUnique({ where: { id: input.id }, select: { scoutingEntryId: true } }) : null;
        if (input.id && before?.scoutingEntryId !== input.scoutingEntryId) {
          throw new TRPCError({ code: "NOT_FOUND", message: "That quotation is not this hotel's." });
        }
        const saved = input.id
          ? await tx.quotation.update({ where: { id: input.id }, data })
          : await tx.quotation.create({ data: { ...data, scoutingEntryId: input.scoutingEntryId, addedById: ctx.session.user.id } });
        // The lines are the quotation's own rows: replaced as a whole.
        await tx.quotationLine.deleteMany({ where: { quotationId: saved.id } });
        await tx.quotationLine.createMany({
          data: lines.map((line, position) => ({
            quotationId: saved.id,
            categoryId: line.categoryId,
            checkIn: parseDay(line.checkIn),
            checkOut: parseDay(line.checkOut),
            rooms: line.rooms,
            rateCents: line.rateCents,
            occupancy: line.occupancy,
            position,
          })),
        });
        const full = withTotals(await tx.quotation.findUniqueOrThrow({ where: { id: saved.id }, include }));
        await logAudit(tx, {
          actorId: ctx.session.user.id,
          entity: "ScoutingEntry",
          entityId: input.scoutingEntryId,
          summary: `${input.id ? "Quotation updated" : "Quotation added"}: ${full.name}`,
          changes: `${full.roomNights} room-nights · ${formatMoney(full.totalCents, full.currency)}${
            full.from && full.to ? ` · ${formatDate(full.from)} – ${formatDate(full.to)}` : ""
          }`,
        });
        return full;
      }),
    ),

  /** Accept a quotation, decline it, or put it back to received. */
  setStatus: protectedProcedure
    .input(z.object({ id: z.string(), status: z.nativeEnum(QuotationStatus) }))
    .mutation(async ({ ctx, input }) => {
      await refuseOnceContracted(ctx.db, input.id, input.status !== "ACCEPTED");
      const saved = await ctx.db.quotation.update({ where: { id: input.id }, data: { status: input.status } });
      await logAudit(ctx.db, {
        actorId: ctx.session.user.id,
        entity: "ScoutingEntry",
        entityId: saved.scoutingEntryId,
        summary: `Quotation ${input.status === "ACCEPTED" ? "accepted" : input.status === "DECLINED" ? "declined" : "back to received"}: ${saved.name}`,
      });
      return saved;
    }),

  remove: protectedProcedure.input(z.object({ id: z.string() })).mutation(async ({ ctx, input }) => {
    await refuseOnceContracted(ctx.db, input.id, true);
    const removed = await ctx.db.quotation.delete({ where: { id: input.id } });
    await logAudit(ctx.db, {
      actorId: ctx.session.user.id,
      entity: "ScoutingEntry",
      entityId: removed.scoutingEntryId,
      summary: `Quotation removed: ${removed.name}`,
    });
  }),

  /**
   * Turn an accepted quotation into the supplier contract (doc §7.1): for this
   * hotel and event, worth the quotation's total, with its PDF link and its
   * terms carried over as notes until they are entered as payments and
   * cut-offs. The quotation is marked accepted and points at its contract.
   */
  makeContract: protectedProcedure.input(z.object({ id: z.string() })).mutation(({ ctx, input }) =>
    ctx.db.$transaction(async (tx) => {
      const quotation = withTotals(await tx.quotation.findUniqueOrThrow({ where: { id: input.id }, include }));
      if (quotation.contract) return quotation.contract;
      const entry = await tx.scoutingEntry.findUniqueOrThrow({
        where: { id: quotation.scoutingEntryId },
        select: { eventId: true, propertyId: true, accountManagerId: true, property: { select: { name: true } } },
      });
      const terms = [
        `From the quotation "${quotation.name}"${quotation.receivedOn ? ` received ${formatDate(quotation.receivedOn)}` : ""}.`,
        quotation.paymentTerms ? `Payment terms as quoted: ${quotation.paymentTerms}` : null,
        quotation.cancellationTerms ? `Cancellation terms as quoted: ${quotation.cancellationTerms}` : null,
      ]
        .filter(Boolean)
        .join("\n\n");
      const contract = await tx.contract.create({
        data: {
          party: "SUPPLIER",
          name: `${entry.property.name} — ${quotation.name}`,
          eventId: entry.eventId,
          propertyId: entry.propertyId,
          totalCents: quotation.totalCents,
          currency: quotation.currency,
          documentUrl: quotation.documentUrl,
          notes: terms,
          ownerId: entry.accountManagerId ?? ctx.session.user.id,
        },
        select: { id: true, name: true, eventId: true },
      });
      await tx.quotation.update({ where: { id: quotation.id }, data: { status: "ACCEPTED", contractId: contract.id } });
      await logAudit(tx, { actorId: ctx.session.user.id, entity: "Contract", entityId: contract.id, summary: `Contract made from the quotation "${quotation.name}"` });
      await logAudit(tx, {
        actorId: ctx.session.user.id,
        entity: "ScoutingEntry",
        entityId: quotation.scoutingEntryId,
        summary: `Quotation accepted and made into a contract: ${quotation.name}`,
      });
      return contract;
    }),
  ),
});
