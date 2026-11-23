import { randomBytes } from "crypto";

import { TRPCError } from "@trpc/server";
import { z } from "zod";

import type { Prisma, PrismaClient } from "generated/prisma";

import { dayKey } from "~/lib/dates";
import { customFields, guestFields, guestSelect, missingGuestInfo, type CustomField, type GuestKey } from "~/lib/guest-info";
import { isVideo, photoSrc } from "~/lib/media";
import { createTRPCRouter, protectedProcedure, publicProcedure } from "~/server/api/trpc";
import { logAudit, logFieldChanges } from "~/server/audit";
import { deliverImmediate, notify } from "~/server/notify";

/**
 * Property information for the client (doc §6.8, the owner 2026-11-23): what
 * guests need to know about each property a client has rooms in, kept on the
 * property, and shown to the client on one live page per sales request —
 * a link sent once, always up to date.
 */

type Db = PrismaClient | Prisma.TransactionClient;

const guestInput = z.object(Object.fromEntries(guestFields.map((field) => [field.key, z.string().max(4000)])) as Record<GuestKey, z.ZodString>);
const customInput = z.array(z.object({ id: z.string().min(1).max(40), label: z.string().trim().min(1, "A field needs a name.").max(120), value: z.string().max(4000) })).max(30);

const clean = (fields: Record<string, string>) => Object.fromEntries(Object.entries(fields).map(([key, value]) => [key, value.trim() || null])) as Record<GuestKey, string | null>;
const tidy = (custom: CustomField[]) => custom.map((field) => ({ id: field.id, label: field.label.trim(), value: field.value.trim() }));
/** The custom fields' changes in words, for the Log. */
function customChanges(before: CustomField[], after: CustomField[]) {
  const lines: string[] = [];
  for (const field of after) {
    const was = before.find((old) => old.id === field.id);
    if (!was) lines.push(`${field.label}: added${field.value ? ` — ${field.value}` : ""}`);
    else if (was.label !== field.label || was.value !== field.value) lines.push(`${field.label}: ${was.value || "—"} → ${field.value || "—"}${was.label !== field.label ? ` (was named ${was.label})` : ""}`);
  }
  for (const field of before) if (!after.some((now) => now.id === field.id)) lines.push(`${field.label}: removed`);
  return lines.join("\n");
}

/** Save the standard and custom fields, with every change in the property's Log. */
async function saveGuestInfo(tx: Prisma.TransactionClient, propertyId: string, data: Record<GuestKey, string | null>, custom: CustomField[], actorId: string | null, summary: string, extra: Prisma.PropertyUpdateInput = {}) {
  const before = await tx.property.findUniqueOrThrow({ where: { id: propertyId }, select: { ...guestSelect, guestCustom: true } });
  const { guestCustom, ...beforeFields } = before;
  await tx.property.update({ where: { id: propertyId }, data: { ...data, guestCustom: custom, ...extra } });
  if (actorId) {
    await logFieldChanges(tx, { actorId, entity: "Property", entityId: propertyId, summary }, beforeFields as Record<GuestKey, string | null>, data, guestFields.map((field) => ({ key: field.key, label: field.label })));
  } else {
    const changed = guestFields.filter((field) => (beforeFields[field.key] ?? null) !== data[field.key]).map((field) => `${field.label}: ${beforeFields[field.key] ?? "—"} → ${data[field.key] ?? "—"}`);
    if (changed.length) await logAudit(tx, { actorId: null, entity: "Property", entityId: propertyId, summary, changes: changed.join("\n") });
  }
  const customs = customChanges(customFields(guestCustom), custom);
  if (customs) await logAudit(tx, { actorId, entity: "Property", entityId: propertyId, summary: `${summary} — extra fields`, changes: customs });
}

/** Every run of nights a client bought: "4 × 3 Bedroom Apartment, 7 Jul – 31 Jul", per property. */
async function stayOf(db: Db, eventId: string, clientId: string) {
  const nights = await db.roomNight.findMany({
    where: { eventId, clientId, salesState: "SOLD" },
    select: { slotId: true, date: true, slot: { select: { category: { select: { id: true, name: true, propertyId: true } } } } },
    orderBy: [{ slotId: "asc" }, { date: "asc" }],
  });
  // Each room's nights, as runs of consecutive nights.
  const runs = new Map<string, { propertyId: string; category: string; checkIn: string; checkOut: string; rooms: number }>();
  let current: { slotId: string; start: Date; last: Date; category: { name: string; propertyId: string } } | null = null;
  const close = () => {
    if (!current) return;
    const checkOut = new Date(current.last.getTime() + 864e5);
    const key = `${current.category.propertyId}|${current.category.name}|${dayKey(current.start)}|${dayKey(checkOut)}`;
    const run = runs.get(key) ?? { propertyId: current.category.propertyId, category: current.category.name, checkIn: dayKey(current.start), checkOut: dayKey(checkOut), rooms: 0 };
    run.rooms++;
    runs.set(key, run);
  };
  for (const night of nights) {
    if (current && current.slotId === night.slotId && night.date.getTime() - current.last.getTime() === 864e5) {
      current.last = night.date;
      continue;
    }
    close();
    current = { slotId: night.slotId, start: night.date, last: night.date, category: night.slot.category };
  }
  close();
  return [...runs.values()].sort((a, b) => a.checkIn.localeCompare(b.checkIn) || a.category.localeCompare(b.category));
}

/** The properties a client has bought rooms in at an event, with what guests need to know about each. */
async function propertiesFor(db: Db, eventId: string, clientId: string) {
  const stay = await stayOf(db, eventId, clientId);
  const ids = [...new Set(stay.map((run) => run.propertyId))];
  const properties = await db.property.findMany({
    where: { id: { in: ids } },
    select: {
      id: true,
      name: true,
      type: true,
      address: true,
      city: true,
      country: true,
      latitude: true,
      longitude: true,
      website: true,
      ...guestSelect,
      guestCustom: true,
      photos: { orderBy: [{ position: "asc" }, { createdAt: "asc" }], select: { url: true }, take: 6 },
    },
    orderBy: { name: "asc" },
  });
  return properties.map(({ photos, guestCustom, ...property }) => ({
    ...property,
    custom: customFields(guestCustom).filter((field) => field.value),
    photo: photos.map((photo) => photo.url).find((url) => !isVideo(url)) ?? null,
    rooms: stay.filter((run) => run.propertyId === property.id).map(({ propertyId: _, ...run }) => run),
  }));
}

export const guestInfoRouter = createTRPCRouter({
  /** A property's guest information, for its tab. */
  property: protectedProcedure.input(z.object({ propertyId: z.string() })).query(({ ctx, input }) =>
    ctx.db.property
      .findUniqueOrThrow({
        where: { id: input.propertyId },
        select: { id: true, name: true, type: true, address: true, city: true, country: true, latitude: true, longitude: true, website: true, ...guestSelect, guestCustom: true, guestToken: true, guestLinkMadeAt: true, guestSubmittedAt: true },
      })
      .then(({ guestCustom, ...property }) => ({ ...property, custom: customFields(guestCustom) })),
  ),

  saveProperty: protectedProcedure.input(guestInput.extend({ propertyId: z.string(), custom: customInput.default([]) })).mutation(async ({ ctx, input }) => {
    const { propertyId, custom, ...fields } = input;
    await ctx.db.$transaction((tx) => saveGuestInfo(tx, propertyId, clean(fields), tidy(custom), ctx.session.user.id, "Guest information changed"));
    return { ok: true };
  }),

  /** A link for the property to fill in its guest information itself; a new one replaces the old. */
  makePropertyLink: protectedProcedure.input(z.object({ propertyId: z.string() })).mutation(async ({ ctx, input }) => {
    const updated = await ctx.db.property.update({
      where: { id: input.propertyId },
      data: { guestToken: randomBytes(24).toString("base64url"), guestLinkMadeAt: new Date(), guestLinkMadeById: ctx.session.user.id },
      select: { guestToken: true },
    });
    await logAudit(ctx.db, { actorId: ctx.session.user.id, entity: "Property", entityId: input.propertyId, summary: "Guest information link made for the property" });
    return updated;
  }),

  switchOffPropertyLink: protectedProcedure.input(z.object({ propertyId: z.string() })).mutation(async ({ ctx, input }) => {
    await ctx.db.property.update({ where: { id: input.propertyId }, data: { guestToken: null } });
    await logAudit(ctx.db, { actorId: ctx.session.user.id, entity: "Property", entityId: input.propertyId, summary: "Guest information link switched off" });
  }),

  /** The property's form, by its link only: the guest information as we have it, to check and complete. */
  propertyForm: publicProcedure.input(z.object({ token: z.string().min(20).max(100) })).query(async ({ ctx, input }) => {
    const property = await ctx.db.property.findUnique({ where: { guestToken: input.token }, select: { name: true, type: true, ...guestSelect, guestCustom: true, guestSubmittedAt: true } });
    if (!property) throw new TRPCError({ code: "NOT_FOUND", message: "This link is not in use any more." });
    const { guestCustom, name, type, guestSubmittedAt, ...values } = property;
    return { name, type, submittedAt: guestSubmittedAt, values: values as Record<GuestKey, string | null>, custom: customFields(guestCustom) };
  }),

  /**
   * The property sends its guest information: it lands on the property as
   * sent, every change in its Log, and whoever made the link is told. The
   * extra fields' names are ours; only what they say comes from the property.
   */
  submitPropertyForm: publicProcedure
    .input(guestInput.extend({ token: z.string().min(20).max(100), custom: z.array(z.object({ id: z.string().max(40), value: z.string().max(4000) })).max(30).default([]) }))
    .mutation(async ({ ctx, input }) => {
      const { token, custom, ...fields } = input;
      await ctx.db.$transaction(async (tx) => {
        const property = await tx.property.findUnique({ where: { guestToken: token }, select: { id: true, name: true, guestCustom: true, guestLinkMadeById: true } });
        if (!property) throw new TRPCError({ code: "NOT_FOUND", message: "This link is not in use any more." });
        const merged = customFields(property.guestCustom).map((field) => ({ ...field, value: (custom.find((sent) => sent.id === field.id)?.value ?? field.value).trim() }));
        await saveGuestInfo(tx, property.id, clean(fields), merged, null, "Guest information sent by the property, through its link", { guestSubmittedAt: new Date() });
        await notify(tx, {
          to: [property.guestLinkMadeById],
          actorId: null,
          kind: "PROPERTY_CONTRACTING_SENT",
          title: `${property.name} sent its guest information`,
          link: `/properties/${property.id}#guest`,
        });
      });
      await deliverImmediate(ctx.db);
      return { ok: true };
    }),

  /** For the request's page: the link, the properties it covers, and what is still missing on each. */
  forRequest: protectedProcedure.input(z.object({ salesRequestId: z.string() })).query(async ({ ctx, input }) => {
    const request = await ctx.db.salesRequest.findUniqueOrThrow({
      where: { id: input.salesRequestId },
      select: { id: true, clientId: true, stayToken: true, stayLinkMadeAt: true, event: { select: { id: true, name: true, guestContact: true } } },
    });
    const properties = request.event ? await propertiesFor(ctx.db, request.event.id, request.clientId) : [];
    return {
      token: request.stayToken,
      madeAt: request.stayLinkMadeAt,
      event: request.event,
      properties: properties.map((property) => ({ id: property.id, name: property.name, rooms: property.rooms, missing: missingGuestInfo(property) })),
    };
  }),

  makeLink: protectedProcedure.input(z.object({ salesRequestId: z.string() })).mutation(async ({ ctx, input }) => {
    const request = await ctx.db.salesRequest.update({
      where: { id: input.salesRequestId },
      data: { stayToken: randomBytes(24).toString("base64url"), stayLinkMadeAt: new Date() },
      select: { stayToken: true },
    });
    await logAudit(ctx.db, { actorId: ctx.session.user.id, entity: "SalesRequest", entityId: input.salesRequestId, summary: "Property information link made for the client" });
    return request;
  }),

  switchOffLink: protectedProcedure.input(z.object({ salesRequestId: z.string() })).mutation(async ({ ctx, input }) => {
    await ctx.db.salesRequest.update({ where: { id: input.salesRequestId }, data: { stayToken: null } });
    await logAudit(ctx.db, { actorId: ctx.session.user.id, entity: "SalesRequest", entityId: input.salesRequestId, summary: "Property information link switched off" });
  }),

  /** We Lodge's contact for guests at the event — on every client's page for it. */
  setEventContact: protectedProcedure.input(z.object({ eventId: z.string(), guestContact: z.string().max(2000) })).mutation(async ({ ctx, input }) => {
    const before = await ctx.db.event.findUniqueOrThrow({ where: { id: input.eventId }, select: { guestContact: true } });
    const guestContact = input.guestContact.trim() || null;
    await ctx.db.event.update({ where: { id: input.eventId }, data: { guestContact } });
    if (before.guestContact !== guestContact) {
      await logAudit(ctx.db, { actorId: ctx.session.user.id, entity: "Event", entityId: input.eventId, summary: "Our contact for guests changed", changes: `${before.guestContact ?? "none"} → ${guestContact ?? "none"}` });
    }
  }),

  /**
   * The client's page, from its link — no sign-in. Only what guests need:
   * never prices, the supplier's own contacts, or our notes.
   */
  shared: publicProcedure.input(z.object({ token: z.string().min(20).max(100) })).query(async ({ ctx, input }) => {
    const request = await ctx.db.salesRequest.findUnique({
      where: { stayToken: input.token },
      select: { clientId: true, client: { select: { name: true } }, event: { select: { id: true, name: true, startDate: true, endDate: true, guestContact: true } } },
    });
    if (!request?.event) throw new TRPCError({ code: "NOT_FOUND", message: "This page is not shared any more." });
    const properties = await propertiesFor(ctx.db, request.event.id, request.clientId);
    return {
      client: request.client.name,
      event: { name: request.event.name, startDate: request.event.startDate, endDate: request.event.endDate, guestContact: request.event.guestContact },
      properties: properties.map((property) => ({ ...property, photo: property.photo ? photoSrc(property.photo) : null })),
    };
  }),
});

