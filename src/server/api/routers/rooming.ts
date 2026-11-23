import { randomBytes } from "crypto";

import { TRPCError } from "@trpc/server";
import { z } from "zod";

import { parseDay } from "~/lib/dates";
import { createTRPCRouter, protectedProcedure, publicProcedure } from "~/server/api/trpc";
import { logAudit } from "~/server/audit";
import { removeStay, roomingList, saveStay } from "~/server/rooming";

/** The rooming list (doc §6.9): the team on the sales request, the client by their link. */

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const stayInput = z.object({
  id: z.string().optional(),
  slotId: z.string(),
  checkIn: day,
  checkOut: day,
  guests: z.array(z.object({ firstName: z.string().max(100), lastName: z.string().max(100) })).max(20),
  arrival: z.string().max(300).default(""),
  notes: z.string().max(2000).default(""),
});
const token = z.string().min(20).max(100);
const asStay = (input: z.infer<typeof stayInput>) => ({ ...input, checkIn: parseDay(input.checkIn), checkOut: parseDay(input.checkOut) });

async function byToken(db: Parameters<typeof roomingList>[0], value: string) {
  const request = await db.salesRequest.findUnique({ where: { roomingToken: value }, select: { id: true } });
  if (!request) throw new TRPCError({ code: "NOT_FOUND", message: "This rooming list is not shared any more." });
  return request.id;
}

export const roomingRouter = createTRPCRouter({
  forRequest: protectedProcedure.input(z.object({ salesRequestId: z.string() })).query(async ({ ctx, input }) => {
    const { request, properties } = await roomingList(ctx.db, input.salesRequestId, { forClient: false });
    return { token: request.roomingToken, madeAt: request.roomingLinkMadeAt, client: request.client.name, event: request.event, properties };
  }),

  saveStay: protectedProcedure.input(stayInput.extend({ salesRequestId: z.string() })).mutation(({ ctx, input }) =>
    ctx.db.$transaction((tx) => saveStay(tx, input.salesRequestId, asStay(input), ctx.session.user.id)).then(() => ({ ok: true })),
  ),

  removeStay: protectedProcedure.input(z.object({ salesRequestId: z.string(), stayId: z.string() })).mutation(({ ctx, input }) =>
    ctx.db.$transaction((tx) => removeStay(tx, input.salesRequestId, input.stayId, ctx.session.user.id)).then(() => ({ ok: true })),
  ),

  /** The building's own number for a room — entered once known; it shows wherever that room does. */
  setUnitNumber: protectedProcedure.input(z.object({ slotId: z.string(), unitNumber: z.string().max(40) })).mutation(async ({ ctx, input }) => {
    const unitNumber = input.unitNumber.trim() || null;
    const before = await ctx.db.roomSlot.findUniqueOrThrow({ where: { id: input.slotId }, select: { unitNumber: true, slotNumber: true, category: { select: { name: true, propertyId: true } } } });
    await ctx.db.roomSlot.update({ where: { id: input.slotId }, data: { unitNumber } });
    if (before.unitNumber !== unitNumber) {
      await logAudit(ctx.db, {
        actorId: ctx.session.user.id,
        entity: "Property",
        entityId: before.category.propertyId,
        summary: `Room number: ${before.category.name} room ${before.slotNumber} is ${unitNumber ?? "no longer numbered"}`,
        changes: `${before.unitNumber ?? "—"} → ${unitNumber ?? "—"}`,
      });
    }
    return { ok: true };
  }),

  makeLink: protectedProcedure.input(z.object({ salesRequestId: z.string() })).mutation(async ({ ctx, input }) => {
    const made = await ctx.db.salesRequest.update({ where: { id: input.salesRequestId }, data: { roomingToken: randomBytes(24).toString("base64url"), roomingLinkMadeAt: new Date() }, select: { roomingToken: true } });
    await logAudit(ctx.db, { actorId: ctx.session.user.id, entity: "SalesRequest", entityId: input.salesRequestId, summary: "Rooming list link made for the client" });
    return made;
  }),

  switchOffLink: protectedProcedure.input(z.object({ salesRequestId: z.string() })).mutation(async ({ ctx, input }) => {
    await ctx.db.salesRequest.update({ where: { id: input.salesRequestId }, data: { roomingToken: null } });
    await logAudit(ctx.db, { actorId: ctx.session.user.id, entity: "SalesRequest", entityId: input.salesRequestId, summary: "Rooming list link switched off" });
  }),

  /** The property was sent its list: changes from now on are flagged for passing on. */
  markSent: protectedProcedure.input(z.object({ salesRequestId: z.string(), propertyId: z.string() })).mutation(async ({ ctx, input }) => {
    await ctx.db.roomingSent.upsert({
      where: { salesRequestId_propertyId: { salesRequestId: input.salesRequestId, propertyId: input.propertyId } },
      update: { sentAt: new Date(), sentById: ctx.session.user.id },
      create: { salesRequestId: input.salesRequestId, propertyId: input.propertyId, sentById: ctx.session.user.id },
    });
    const property = await ctx.db.property.findUnique({ where: { id: input.propertyId }, select: { name: true } });
    await logAudit(ctx.db, { actorId: ctx.session.user.id, entity: "SalesRequest", entityId: input.salesRequestId, summary: `Rooming list sent to ${property?.name ?? "the property"}` });
    return { ok: true };
  }),

  // --- The client, by their link ----------------------------------------------

  shared: publicProcedure.input(z.object({ token })).query(async ({ ctx, input }) => {
    const id = await byToken(ctx.db, input.token);
    const { request, properties } = await roomingList(ctx.db, id, { forClient: true });
    return { client: request.client.name, event: request.event, properties };
  }),

  saveStayByLink: publicProcedure.input(stayInput.extend({ token })).mutation(async ({ ctx, input }) => {
    const id = await byToken(ctx.db, input.token);
    await ctx.db.$transaction((tx) => saveStay(tx, id, asStay(input), null));
    return { ok: true };
  }),

  removeStayByLink: publicProcedure.input(z.object({ token, stayId: z.string() })).mutation(async ({ ctx, input }) => {
    const id = await byToken(ctx.db, input.token);
    await ctx.db.$transaction((tx) => removeStay(tx, id, input.stayId, null));
    return { ok: true };
  }),
});
