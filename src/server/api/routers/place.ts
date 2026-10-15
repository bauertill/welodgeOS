import type { Prisma } from "generated/prisma";
import { TRPCError } from "@trpc/server";
import { z } from "zod";

import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";

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
