import { z } from "zod";

import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";

const SCOUTING_STATUSES = [
  "PROSPECT",
  "CONTACTED",
  "SHORTLISTED",
  "REJECTED",
  "CONTRACTED",
] as const;

/**
 * The scouting list: which properties are on the table for a given event, and
 * how far each has got. A property lives once in the system and appears on as
 * many events' lists as we like (doc §3.5).
 */
export const scoutingRouter = createTRPCRouter({
  listForEvent: protectedProcedure
    .input(
      z.object({
        eventId: z.string(),
        status: z.enum(SCOUTING_STATUSES).optional(),
        type: z.enum(["HOTEL", "APARTMENT"]).optional(),
        amenityIds: z.array(z.string()).default([]),
      }),
    )
    .query(({ ctx, input }) =>
      ctx.db.scoutingEntry.findMany({
        where: {
          eventId: input.eventId,
          status: input.status,
          property: {
            type: input.type,
            // Every selected amenity must be present, not just one of them —
            // the filter narrows the list rather than widening it.
            ...(input.amenityIds.length
              ? {
                  AND: input.amenityIds.map((id) => ({
                    amenities: { some: { id } },
                  })),
                }
              : {}),
          },
        },
        orderBy: { property: { name: "asc" } },
        include: {
          property: {
            include: {
              categories: { orderBy: { sortOrder: "asc" } },
              amenities: { orderBy: { sortOrder: "asc" } },
            },
          },
          addedBy: { select: { name: true, email: true } },
        },
      }),
    ),

  /** Properties not yet on this event's list, for the "add" picker. */
  candidates: protectedProcedure
    .input(z.object({ eventId: z.string() }))
    .query(({ ctx, input }) =>
      ctx.db.property.findMany({
        where: { scoutingEntries: { none: { eventId: input.eventId } } },
        orderBy: { name: "asc" },
        select: { id: true, name: true, city: true, type: true },
      }),
    ),

  add: protectedProcedure
    .input(z.object({ eventId: z.string(), propertyId: z.string() }))
    .mutation(({ ctx, input }) =>
      ctx.db.scoutingEntry.create({
        data: { ...input, addedById: ctx.session.user.id },
      }),
    ),

  setStatus: protectedProcedure
    .input(z.object({ id: z.string(), status: z.enum(SCOUTING_STATUSES) }))
    .mutation(({ ctx, input }) =>
      ctx.db.scoutingEntry.update({
        where: { id: input.id },
        data: { status: input.status },
      }),
    ),

  setNotes: protectedProcedure
    .input(z.object({ id: z.string(), notes: z.string() }))
    .mutation(({ ctx, input }) =>
      ctx.db.scoutingEntry.update({
        where: { id: input.id },
        data: { notes: input.notes.trim() || null },
      }),
    ),

  remove: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(({ ctx, input }) =>
      ctx.db.scoutingEntry.delete({ where: { id: input.id } }),
    ),
});
