import type { Prisma } from "generated/prisma";
import { TRPCError } from "@trpc/server";
import { z } from "zod";

import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";
import { logAudit } from "~/server/audit";
import { findMatch } from "~/lib/map-match";
import { createFoundProperty } from "~/server/found-property";
import { ensureHotelContactTask } from "~/server/hotel-contact";
import { deliverImmediate } from "~/server/notify";

/**
 * A place of interest: somewhere guests need to get to for one event — a
 * venue, an airport, a station, the IBC (doc §3.7).
 *
 * Coordinates are required here, unlike a property's. A property with no
 * coordinates is still a property; a place nobody can locate is useless, since
 * its whole purpose is to be measured from.
 */
const placeInput = z.object({
  eventId: z.string(),
  name: z.string().min(1, "Give the place a name"),
  category: z.enum(["VENUE", "TRAIN_STATION", "AIRPORT", "OTHER"]),
  /** Stations: "RER A, M1". Free text, and only ever read back. */
  lines: z.string().optional(),
  address: z.string().optional(),
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  notes: z.string().optional(),
  /** Its map layer (doc §3.7); left out, the layer named after its kind, made if need be. */
  layerId: z.string().optional(),
});

const kindLayers = {
  VENUE: { name: "Venues", color: "#9b1c31", measured: true, position: 0 },
  TRAIN_STATION: { name: "Train stations", color: "#1d5fa8", measured: false, position: 1 },
  AIRPORT: { name: "Airports", color: "#0a7a47", measured: false, position: 2 },
  OTHER: { name: "Other places", color: "#8a5a00", measured: false, position: 3 },
} as const;

/** The layer a place goes on: the one chosen (if it is this event's), else its kind's own. */
async function layerFor(db: Prisma.TransactionClient, eventId: string, category: keyof typeof kindLayers, layerId?: string) {
  if (layerId) {
    const layer = await db.mapLayer.findUnique({ where: { id: layerId }, select: { eventId: true } });
    if (layer?.eventId !== eventId) throw new TRPCError({ code: "BAD_REQUEST", message: "That layer is not this event's." });
    return layerId;
  }
  const kind = kindLayers[category];
  const layer = await db.mapLayer.upsert({
    where: { eventId_name: { eventId, name: kind.name } },
    update: {},
    create: { eventId, ...kind },
    select: { id: true },
  });
  return layer.id;
}

/** Empty strings arrive from HTML inputs; the database wants nulls. */
const blank = (value: string | undefined) =>
  value?.trim() ? value.trim() : null;

export const placeRouter = createTRPCRouter({
  listForEvent: protectedProcedure
    .input(z.object({ eventId: z.string() }))
    .query(({ ctx, input }) =>
      ctx.db.placeOfInterest.findMany({
        where: { eventId: input.eventId },
        orderBy: [{ category: "asc" }, { name: "asc" }],
        include: { layer: { select: { id: true, name: true, color: true, measured: true } } },
      }),
    ),

  create: protectedProcedure
    .input(placeInput)
    .mutation(async ({ ctx, input }) => {
      await refuseDuplicate(ctx.db, input.eventId, input.name);

      const { layerId, ...fields } = input;
      return ctx.db.placeOfInterest.create({
        data: {
          ...fields,
          layerId: await layerFor(ctx.db, input.eventId, input.category, layerId),
          name: input.name.trim(),
          lines: blank(input.lines),
          address: blank(input.address),
          notes: blank(input.notes),
        },
      });
    }),

  update: protectedProcedure
    .input(placeInput.extend({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const { id, eventId, layerId, ...place } = input;
      await refuseDuplicate(ctx.db, eventId, place.name, id);

      return ctx.db.placeOfInterest.update({
        where: { id },
        data: {
          ...place,
          layerId: await layerFor(ctx.db, eventId, place.category, layerId),
          name: place.name.trim(),
          lines: blank(place.lines),
          address: blank(place.address),
          notes: blank(place.notes),
        },
      });
    }),

  /**
   * The property in our library a point looks to be — the same name, or the
   * same spot (doc §3.7) — and whether it is on the point's event's board.
   */
  matchProperty: protectedProcedure.input(z.object({ id: z.string() })).query(async ({ ctx, input }) => {
    const place = await ctx.db.placeOfInterest.findUnique({ where: { id: input.id }, select: { name: true, latitude: true, longitude: true, eventId: true } });
    if (!place) return null;
    const library = await ctx.db.property.findMany({ select: { id: true, name: true, latitude: true, longitude: true } });
    const match = findMatch(place, library, "property");
    if (!match) return null;
    const entry = await ctx.db.scoutingEntry.findFirst({ where: { eventId: place.eventId, propertyId: match.id }, select: { id: true } });
    return { ...match, onBoard: Boolean(entry) };
  }),

  /**
   * A point that is a property we already have: that property put on the
   * event's board (with a hotel contact task) if it is not there yet, and the
   * point taken off the map — the property has its own pin.
   */
  toExistingProperty: protectedProcedure.input(z.object({ id: z.string(), propertyId: z.string() })).mutation(async ({ ctx, input }) => {
    const result = await ctx.db.$transaction(async (tx) => {
      const place = await tx.placeOfInterest.findUnique({ where: { id: input.id }, select: { id: true, name: true, eventId: true, layer: { select: { name: true } } } });
      if (!place) throw new TRPCError({ code: "NOT_FOUND", message: "That point is not on the map any more." });
      const property = await tx.property.findUniqueOrThrow({ where: { id: input.propertyId }, select: { id: true, name: true } });
      const already = await tx.scoutingEntry.findFirst({ where: { eventId: place.eventId, propertyId: property.id }, select: { id: true } });
      if (!already) {
        const entry = await tx.scoutingEntry.create({ data: { eventId: place.eventId, propertyId: property.id, addedById: ctx.session.user.id } });
        await logAudit(tx, { actorId: ctx.session.user.id, entity: "ScoutingEntry", entityId: entry.id, summary: `Added to the scouting list — from the map's ${place.layer?.name ?? "places"} layer` });
        await ensureHotelContactTask(tx, { propertyId: property.id, eventId: place.eventId, salesRequestId: null, actorId: ctx.session.user.id });
      }
      await tx.placeOfInterest.delete({ where: { id: place.id } });
      await logAudit(tx, { actorId: ctx.session.user.id, entity: "Event", entityId: place.eventId, summary: `Map point "${place.name}" is ${property.name}${already ? ", already on the board — point removed" : " — put on the properties board"}` });
      return { propertyId: property.id, added: !already };
    });
    await deliverImmediate(ctx.db);
    return result;
  }),

  /**
   * A point that was only on the map — a hotel from research — put on the
   * properties board after all (the owner, 2026-11-24: "we can either add it
   * to the property board or not"): the property made from it, on the event's
   * board with a hotel contact task, and the point taken off its layer, as the
   * property now has its own pin.
   */
  toProperty: protectedProcedure
    .input(z.object({ id: z.string(), name: z.string().trim().min(1, "Give it a name").max(300), type: z.enum(["HOTEL", "APARTMENT", "APARTHOTEL"]), stars: z.number().int().min(1).max(5).nullable() }))
    .mutation(async ({ ctx, input }) => {
      const made = await ctx.db.$transaction(async (tx) => {
        const place = await tx.placeOfInterest.findUnique({ where: { id: input.id }, include: { event: { select: { id: true, name: true } }, layer: { select: { name: true } } } });
        if (!place) throw new TRPCError({ code: "NOT_FOUND", message: "That point is not on the map any more." });
        const made = await createFoundProperty(tx, {
          place: {
            name: input.name,
            type: input.type,
            latitude: place.latitude,
            longitude: place.longitude,
            address: place.address,
            city: null,
            country: null,
            website: null,
            phone: null,
            stars: input.stars,
            rooms: null,
            source: "map",
          },
          eventId: place.eventId,
          salesRequestId: null,
          foundWhile: `for ${place.event.name}`,
          actorId: ctx.session.user.id,
        });
        // Its notes say where it came from, with what the map said of it.
        const from = `Was on the map's ${place.layer?.name ?? "places"} layer as "${place.name}".${place.notes ? `\n${place.notes}` : ""}`;
        const property = await tx.property.findUniqueOrThrow({ where: { id: made.id }, select: { notes: true } });
        await tx.property.update({ where: { id: made.id }, data: { notes: [property.notes?.replace("Spotted on the ground and added from the map", "Added from the map"), from].filter(Boolean).join("\n") } });
        await tx.placeOfInterest.delete({ where: { id: place.id } });
        await logAudit(tx, { actorId: ctx.session.user.id, entity: "Event", entityId: place.eventId, summary: `Map point put on the properties board: ${input.name}`, changes: place.layer ? `From the ${place.layer.name} layer` : null });
        return made;
      });
      await deliverImmediate(ctx.db);
      return made;
    }),

  /**
   * Nothing hangs off a place of interest — it is measured from, never booked
   * against — so removing one takes nothing with it.
   */
  remove: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(({ ctx, input }) =>
      ctx.db.placeOfInterest.delete({ where: { id: input.id } }),
    ),
});

/**
 * Two pins with the same name on one map is a mistake, not a distinction. The
 * database enforces this too; catching it here is what makes the message
 * readable rather than a constraint violation.
 */
async function refuseDuplicate(
  db: typeof import("~/server/db").db,
  eventId: string,
  name: string,
  exceptId?: string,
) {
  const duplicate = await db.placeOfInterest.findFirst({
    where: {
      eventId,
      name: { equals: name.trim(), mode: "insensitive" },
      ...(exceptId ? { id: { not: exceptId } } : {}),
    },
    select: { id: true },
  });

  if (duplicate) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: `"${name.trim()}" is already on this event's list of places.`,
    });
  }
}
