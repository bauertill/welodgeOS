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
  category: z.enum(["VENUE", "TRAIN_STATION", "AIRPORT", "IBC", "OTHER"]),
  /** Stations: "RER A, M1". Free text, and only ever read back. */
  lines: z.string().optional(),
  address: z.string().optional(),
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  notes: z.string().optional(),
});

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
      }),
    ),

  create: protectedProcedure
    .input(placeInput)
    .mutation(async ({ ctx, input }) => {
      await refuseDuplicate(ctx.db, input.eventId, input.name);

      return ctx.db.placeOfInterest.create({
        data: {
          ...input,
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
      const { id, eventId, ...place } = input;
      await refuseDuplicate(ctx.db, eventId, place.name, id);

      return ctx.db.placeOfInterest.update({
        where: { id },
        data: {
          ...place,
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
