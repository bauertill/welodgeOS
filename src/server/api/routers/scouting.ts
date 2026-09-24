import { z } from "zod";

import { categoryContractStatusLabels, scoutingStatusLabels } from "~/lib/scouting";
import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";
import { logAudit } from "~/server/audit";

// `CONTRACTED` is deliberately excluded — a property has no single contract
// status of its own any more; that lives per room category (doc §3.5, §3.6).
const SCOUTING_STATUSES = [
  "PROSPECT",
  "CONTACTED",
  "SHORTLISTED",
  "REJECTED",
] as const;

const CATEGORY_CONTRACT_STATUSES = [
  "IN_NEGOTIATION",
  "IN_CONTRACTING",
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
        type: z.enum(["HOTEL", "APARTMENT", "APARTHOTEL"]).optional(),
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
          // Absent for a category means "in negotiation" — see
          // `categoryContractStatusLabels` in ~/lib/scouting (doc §3.5).
          categoryContracts: true,
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
      ctx.db.$transaction(async (tx) => {
        const entry = await tx.scoutingEntry.create({
          data: { ...input, addedById: ctx.session.user.id },
        });
        await logAudit(tx, {
          actorId: ctx.session.user.id,
          entity: "ScoutingEntry",
          entityId: entry.id,
          summary: "Added to the scouting list",
        });
        return entry;
      }),
    ),

  setStatus: protectedProcedure
    .input(z.object({ id: z.string(), status: z.enum(SCOUTING_STATUSES) }))
    .mutation(({ ctx, input }) =>
      ctx.db.$transaction(async (tx) => {
        const before = await tx.scoutingEntry.findUniqueOrThrow({
          where: { id: input.id },
        });
        const updated = await tx.scoutingEntry.update({
          where: { id: input.id },
          data: { status: input.status },
        });
        if (before.status !== input.status) {
          await logAudit(tx, {
            actorId: ctx.session.user.id,
            entity: "ScoutingEntry",
            entityId: input.id,
            summary: `Status: ${scoutingStatusLabels[before.status]} → ${scoutingStatusLabels[input.status]}`,
          });
        }
        return updated;
      }),
    ),

  /**
   * One room category's own supplier-contract status on this event's
   * scouting list — the granular fact that materialising a category into
   * inventory is actually gated on (doc §3.5, §3.6).
   */
  setCategoryContractStatus: protectedProcedure
    .input(
      z.object({
        scoutingEntryId: z.string(),
        categoryId: z.string(),
        status: z.enum(CATEGORY_CONTRACT_STATUSES),
      }),
    )
    .mutation(({ ctx, input }) =>
      ctx.db.$transaction(async (tx) => {
        const before = await tx.categoryContract.findUnique({
          where: {
            scoutingEntryId_categoryId: {
              scoutingEntryId: input.scoutingEntryId,
              categoryId: input.categoryId,
            },
          },
        });
        const contract = await tx.categoryContract.upsert({
          where: {
            scoutingEntryId_categoryId: {
              scoutingEntryId: input.scoutingEntryId,
              categoryId: input.categoryId,
            },
          },
          update: { status: input.status },
          create: {
            scoutingEntryId: input.scoutingEntryId,
            categoryId: input.categoryId,
            status: input.status,
          },
        });
        const beforeStatus = before?.status ?? "IN_NEGOTIATION";
        if (beforeStatus !== input.status) {
          await logAudit(tx, {
            actorId: ctx.session.user.id,
            entity: "CategoryContract",
            entityId: contract.id,
            summary: `Contract status: ${categoryContractStatusLabels[beforeStatus]} → ${categoryContractStatusLabels[input.status]}`,
          });
        }
        return contract;
      }),
    ),

  setNotes: protectedProcedure
    .input(z.object({ id: z.string(), notes: z.string() }))
    .mutation(({ ctx, input }) =>
      ctx.db.$transaction(async (tx) => {
        const notes = input.notes.trim() || null;
        const updated = await tx.scoutingEntry.update({
          where: { id: input.id },
          data: { notes },
        });
        await logAudit(tx, {
          actorId: ctx.session.user.id,
          entity: "ScoutingEntry",
          entityId: input.id,
          summary: "Notes updated",
        });
        return updated;
      }),
    ),

  remove: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(({ ctx, input }) =>
      ctx.db.$transaction(async (tx) => {
        // Written before the delete, and against the property (not the
        // scouting entry itself) — once removed, there is no scouting-entry
        // page left for this to show up on.
        const entry = await tx.scoutingEntry.findUniqueOrThrow({
          where: { id: input.id },
          include: { property: { select: { id: true, name: true } }, event: true },
        });
        await logAudit(tx, {
          actorId: ctx.session.user.id,
          entity: "Property",
          entityId: entry.propertyId,
          summary: `Removed from "${entry.event.name}"'s scouting list`,
        });
        return tx.scoutingEntry.delete({ where: { id: input.id } });
      }),
    ),
});
