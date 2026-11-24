import { randomBytes } from "crypto";

import { TRPCError } from "@trpc/server";
import { z } from "zod";

import { parseDay } from "~/lib/dates";
import { createTRPCRouter, protectedProcedure, publicProcedure } from "~/server/api/trpc";
import { logAudit } from "~/server/audit";
import { formatDate } from "~/lib/format";
import { plainEmail, sendEmail } from "~/server/email";
import { deliverImmediate } from "~/server/notify";
import { applyImport, markSent, masterList, previewImport, removeStay, roomingList, saveStay, submissionsFor, submitList } from "~/server/rooming";
import { masterWorkbook } from "~/server/rooming-excel";

/** The rooming list (doc §6.9): the team on the sales request, the client by their link. */

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const guestInput = z.object({
  firstName: z.string().max(100),
  lastName: z.string().max(100),
  gender: z.string().max(40).optional(),
  nationality: z.string().max(100).optional(),
  passport: z.string().max(60).optional(),
  email: z.string().max(200).optional(),
});
const stayInput = z.object({
  id: z.string().optional(),
  slotId: z.string(),
  checkIn: day,
  checkOut: day,
  guests: z.array(guestInput).max(20),
  arrival: z.string().max(300).default(""),
  notes: z.string().max(2000).default(""),
});
const token = z.string().min(20).max(100);
const importRows = z
  .array(
    z.object({
      rows: z.array(z.number().int()).max(50),
      guests: z.array(guestInput).max(20),
      checkIn: day.nullable(),
      checkOut: day.nullable(),
      property: z.string().max(200).nullable(),
      roomType: z.string().max(200).nullable(),
      roomNumber: z.string().max(40).nullable(),
      roomKey: z.string().max(100).nullable().optional(),
      arrival: z.string().max(300).nullable().optional(),
      notes: z.string().max(2000).nullable().optional(),
    }),
  )
  .max(2000);
const emailAddress = z.string().trim().email("That is not an email address.");
const asStay = (input: z.infer<typeof stayInput>) => ({ ...input, checkIn: parseDay(input.checkIn), checkOut: parseDay(input.checkOut) });

async function byToken(db: Parameters<typeof roomingList>[0], value: string) {
  const request = await db.salesRequest.findUnique({ where: { roomingToken: value }, select: { id: true } });
  if (!request) throw new TRPCError({ code: "NOT_FOUND", message: "This rooming list is not shared any more." });
  return request.id;
}

export const roomingRouter = createTRPCRouter({
  forRequest: protectedProcedure.input(z.object({ salesRequestId: z.string() })).query(async ({ ctx, input }) => {
    const { request, properties } = await roomingList(ctx.db, input.salesRequestId, { forClient: false });
    return { token: request.roomingToken, madeAt: request.roomingLinkMadeAt, fields: request.roomingFields, client: request.client.name, event: request.event, properties };
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

  /** The client's submitted versions, and what changed since the last (doc §6.9). */
  submissions: protectedProcedure.input(z.object({ salesRequestId: z.string() })).query(({ ctx, input }) => submissionsFor(ctx.db, input.salesRequestId, false)),

  /** The team saves the list as it stands as the client's next version. */
  submit: protectedProcedure.input(z.object({ salesRequestId: z.string() })).mutation(async ({ ctx, input }) => {
    const done = await ctx.db.$transaction((tx) => submitList(tx, input.salesRequestId, ctx.session.user.id));
    await deliverImmediate(ctx.db);
    return done;
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

  /**
   * A property's master rooming list at an event (doc §6.9): every client's
   * rooms and guests there — and the events it has any at, to choose from.
   */
  forProperty: protectedProcedure.input(z.object({ propertyId: z.string(), eventId: z.string().nullable() })).query(async ({ ctx, input }) => {
    const events = await ctx.db.event.findMany({
      where: { roomNights: { some: { salesState: "SOLD", slot: { category: { propertyId: input.propertyId } } } } },
      orderBy: { startDate: "desc" },
      select: { id: true, name: true },
    });
    const eventId = input.eventId && events.some((one) => one.id === input.eventId) ? input.eventId : (events[0]?.id ?? null);
    // Where the hotel's list usually goes: the property's own addresses and its contacts'.
    const property = await ctx.db.property.findUnique({ where: { id: input.propertyId }, select: { generalEmail: true, contractEmail: true, contacts: { select: { name: true, role: true, email: true } } } });
    const addresses = [
      ...(property?.contacts ?? []).filter((one) => one.email).map((one) => ({ email: one.email!.trim(), label: [one.name, one.role].filter(Boolean).join(", ") })),
      ...(property?.generalEmail ? [{ email: property.generalEmail.trim(), label: "General email" }] : []),
      ...(property?.contractEmail ? [{ email: property.contractEmail.trim(), label: "Contracts email" }] : []),
    ].filter((one, i, all) => all.findIndex((other) => other.email.toLowerCase() === one.email.toLowerCase()) === i);
    return { events, eventId, addresses, master: eventId ? await masterList(ctx.db, eventId, input.propertyId) : null };
  }),

  /** The property was sent its master list: kept as the next version; changes from now on are shown against it. */
  markSent: protectedProcedure.input(z.object({ eventId: z.string(), propertyId: z.string() })).mutation(({ ctx, input }) =>
    ctx.db.$transaction((tx) => markSent(tx, input.eventId, input.propertyId, ctx.session.user.id)).then((number) => ({ number })),
  ),

  /**
   * Email the property its master list (doc §6.9, the owner 2026-11-24: "a send
   * to hotel button where we can insert an email address and a message"): the
   * Excel attached as the next version, a copy to the sender, replies to them —
   * and only once it has gone, kept as that version.
   */
  sendToProperty: protectedProcedure
    .input(z.object({ eventId: z.string(), propertyId: z.string(), to: z.array(emailAddress).min(1, "Give the email address to send it to.").max(10), message: z.string().trim().min(1, "Write a message to go with it.").max(5000) }))
    .mutation(async ({ ctx, input }) => {
      const me = await ctx.db.user.findUniqueOrThrow({ where: { id: ctx.session.user.id }, select: { name: true, email: true } });
      const last = await ctx.db.roomingVersion.findFirst({ where: { eventId: input.eventId, propertyId: input.propertyId }, orderBy: { number: "desc" }, select: { number: true } });
      const number = (last?.number ?? 0) + 1;
      const [{ file, name }, property, event] = await Promise.all([
        masterWorkbook(ctx.db, input.eventId, input.propertyId, { sending: { number, by: me.name ?? me.email ?? "We Lodge" } }),
        ctx.db.property.findUniqueOrThrow({ where: { id: input.propertyId }, select: { name: true } }),
        ctx.db.event.findUniqueOrThrow({ where: { id: input.eventId }, select: { name: true } }),
      ]);
      const subject = `Rooming list V${number} — ${property.name} — ${event.name}`;
      const body = plainEmail(input.message);
      for (const to of input.to) {
        const sent = await sendEmail({ to, subject, ...body, cc: me.email ? [me.email] : [], replyTo: me.email ?? undefined, fromName: me.name ? `${me.name} · We Lodge` : "We Lodge", attachments: [{ filename: name, content: file }] });
        if (!sent) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: `The email to ${to} could not be sent — nothing was marked as sent. Try again in a moment.` });
      }
      await ctx.db.$transaction((tx) => markSent(tx, input.eventId, input.propertyId, ctx.session.user.id, { to: input.to.join(", "), message: input.message }));
      return { number, sentOn: formatDate(new Date()) };
    }),

  /** Which extra details this client's list asks for, per guest (doc §6.9). */
  setFields: protectedProcedure.input(z.object({ salesRequestId: z.string(), fields: z.array(z.enum(["gender", "nationality", "passport", "email"])).max(4) })).mutation(async ({ ctx, input }) => {
    await ctx.db.salesRequest.update({ where: { id: input.salesRequestId }, data: { roomingFields: input.fields } });
    await logAudit(ctx.db, { actorId: ctx.session.user.id, entity: "SalesRequest", entityId: input.salesRequestId, summary: "Rooming list asks for", changes: input.fields.length ? input.fields.join(", ") : "names and arrival only" });
    return { ok: true };
  }),

  /** What the client's sheet would change — nothing is saved. */
  previewImport: protectedProcedure.input(z.object({ salesRequestId: z.string(), sheet: importRows })).mutation(({ ctx, input }) => previewImport(ctx.db, input.salesRequestId, input.sheet)),

  applyImport: protectedProcedure
    .input(z.object({ salesRequestId: z.string(), sheet: importRows, removeMissing: z.boolean().default(false), fileName: z.string().max(300).default("") }))
    .mutation(async ({ ctx, input }) => {
      const done = await applyImport(ctx.db, input.salesRequestId, input.sheet, input.removeMissing, ctx.session.user.id);
      await logAudit(ctx.db, { actorId: ctx.session.user.id, entity: "SalesRequest", entityId: input.salesRequestId, summary: `Rooming list read from ${input.fileName || "a spreadsheet"}`, changes: `${done.added} added, ${done.changed} changed, ${done.removed} taken out, ${done.problems + done.failed.length} not placed` });
      return done;
    }),

  // --- The client, by their link ----------------------------------------------

  previewImportByLink: publicProcedure.input(z.object({ token, sheet: importRows })).mutation(async ({ ctx, input }) => previewImport(ctx.db, await byToken(ctx.db, input.token), input.sheet)),

  applyImportByLink: publicProcedure
    .input(z.object({ token, sheet: importRows, removeMissing: z.boolean().default(false), fileName: z.string().max(300).default("") }))
    .mutation(async ({ ctx, input }) => {
      const id = await byToken(ctx.db, input.token);
      const done = await applyImport(ctx.db, id, input.sheet, input.removeMissing, null);
      await logAudit(ctx.db, { actorId: null, entity: "SalesRequest", entityId: id, summary: `Rooming list read from ${input.fileName || "a spreadsheet"}, by the client`, changes: `${done.added} added, ${done.changed} changed, ${done.removed} taken out, ${done.problems + done.failed.length} not placed` });
      return done;
    }),

  shared: publicProcedure.input(z.object({ token })).query(async ({ ctx, input }) => {
    const id = await byToken(ctx.db, input.token);
    const { request, properties } = await roomingList(ctx.db, id, { forClient: true });
    return { fields: request.roomingFields, client: request.client.name, event: request.event, properties };
  }),

  /** The client's own versions, by their link. */
  submissionsByLink: publicProcedure.input(z.object({ token })).query(async ({ ctx, input }) => submissionsFor(ctx.db, await byToken(ctx.db, input.token), true)),

  /** The client presses Submit: their list as it stands becomes their next version, and our team is told. */
  submitByLink: publicProcedure.input(z.object({ token })).mutation(async ({ ctx, input }) => {
    const id = await byToken(ctx.db, input.token);
    const done = await ctx.db.$transaction((tx) => submitList(tx, id, null));
    await deliverImmediate(ctx.db);
    return done;
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
