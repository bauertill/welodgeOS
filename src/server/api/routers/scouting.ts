import { TRPCError } from "@trpc/server";
import { GroupColour } from "generated/prisma";
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
  // --- A property on this event: its terms (doc §3.9) ------------------------

  /**
   * One entry with everything the side panel shows: the terms agreed for this
   * event, and the property's own details, contacts and contracting details —
   * with its provider's, for the fallback.
   */
  entry: protectedProcedure.input(z.object({ id: z.string() })).query(({ ctx, input }) =>
    ctx.db.scoutingEntry.findUnique({
      where: { id: input.id },
      include: {
        accountManager: { select: { id: true, name: true, email: true } },
        categoryContracts: true,
        property: {
          include: {
            categories: { orderBy: { sortOrder: "asc" } },
            contacts: { orderBy: { name: "asc" } },
            amenities: { orderBy: { sortOrder: "asc" } },
            provider: { include: { contacts: { orderBy: { name: "asc" } } } },
          },
        },
      },
    }),
  ),

  /** Save the terms agreed for this property on this event. */
  updateTerms: protectedProcedure
    .input(
      z.object({
        id: z.string(),
        accountManagerId: z.string().nullable(),
        applicablePeriod: z.string().max(5000),
        ratesInclude: z.string().max(5000),
        deposit: z.string().max(5000),
        cancellationTerms: z.string().max(5000),
        paymentTerms: z.string().max(5000),
        blockExpiry: z.date().nullable(),
        roomingListDeadline: z.date().nullable(),
        minimumStayNights: z.number().int().min(1, "A minimum stay is at least one night.").max(365).nullable(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { id, ...terms } = input;
      const text = (value: string) => (value.trim() ? value.trim() : null);
      const updated = await ctx.db.scoutingEntry.update({
        where: { id },
        data: {
          ...terms,
          applicablePeriod: text(terms.applicablePeriod),
          ratesInclude: text(terms.ratesInclude),
          deposit: text(terms.deposit),
          cancellationTerms: text(terms.cancellationTerms),
          paymentTerms: text(terms.paymentTerms),
        },
      });
      await logAudit(ctx.db, {
        actorId: ctx.session.user.id,
        entity: "ScoutingEntry",
        entityId: id,
        summary: "Terms updated",
      });
      return updated;
    }),

  /**
   * The rates and taxes agreed for one room category on this event (doc
   * §3.9). Stored beside the category's contract status for this event, so
   * another event's rates for the same room type are never touched. A
   * category with no contract row yet gets one, still "in negotiation".
   */
  setCategoryTerms: protectedProcedure
    .input(
      z.object({
        scoutingEntryId: z.string(),
        categoryId: z.string(),
        ratePerNightCents: z.number().int().min(0).nullable(),
        rateCurrency: z.string().length(3).nullable(),
        rateIncludes: z.string().max(2000),
        totBasisPoints: z.number().int().min(0).max(10000).nullable(),
        otherTaxes: z.string().max(2000),
        applicablePeriod: z.string().max(2000),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { scoutingEntryId, categoryId, ...terms } = input;
      const text = (value: string) => (value.trim() ? value.trim() : null);
      if (terms.ratePerNightCents !== null && !terms.rateCurrency) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Say which currency the rate is in." });
      }
      const data = {
        ratePerNightCents: terms.ratePerNightCents,
        // A currency with no amount behind it is noise (§4.5).
        rateCurrency: terms.ratePerNightCents === null ? null : terms.rateCurrency,
        rateIncludes: text(terms.rateIncludes),
        totBasisPoints: terms.totBasisPoints,
        otherTaxes: text(terms.otherTaxes),
        applicablePeriod: text(terms.applicablePeriod),
      };
      const saved = await ctx.db.categoryContract.upsert({
        where: { scoutingEntryId_categoryId: { scoutingEntryId, categoryId } },
        update: data,
        create: { scoutingEntryId, categoryId, ...data },
      });
      await logAudit(ctx.db, {
        actorId: ctx.session.user.id,
        entity: "ScoutingEntry",
        entityId: scoutingEntryId,
        summary: "Room category rates updated",
      });
      return saved;
    }),

  // --- Groups on the Properties tab (doc §3.9) --------------------------------

  /** An event's groups, top first. */
  groups: protectedProcedure
    .input(z.object({ eventId: z.string() }))
    .query(({ ctx, input }) =>
      ctx.db.propertyGroup.findMany({
        where: { eventId: input.eventId },
        orderBy: [{ position: "asc" }, { createdAt: "asc" }],
      }),
    ),

  createGroup: protectedProcedure
    .input(
      z.object({
        eventId: z.string(),
        name: z.string().trim().min(1, "A group needs a name.").max(120),
        colour: z.nativeEnum(GroupColour),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const last = await ctx.db.propertyGroup.aggregate({
        where: { eventId: input.eventId },
        _max: { position: true },
      });
      // New groups go at the bottom, as on Monday.
      return ctx.db.propertyGroup.create({
        data: { ...input, position: (last._max.position ?? -1) + 1 },
      });
    }),

  /** Rename or recolour a group. */
  updateGroup: protectedProcedure
    .input(
      z.object({
        id: z.string(),
        name: z.string().trim().min(1, "A group needs a name.").max(120).optional(),
        colour: z.nativeEnum(GroupColour).optional(),
      }),
    )
    .mutation(({ ctx, input }) =>
      ctx.db.propertyGroup.update({
        where: { id: input.id },
        data: { name: input.name, colour: input.colour },
      }),
    ),

  /** Move a group one place up or down the page. */
  moveGroup: protectedProcedure
    .input(z.object({ id: z.string(), direction: z.enum(["up", "down"]) }))
    .mutation(async ({ ctx, input }) => {
      const group = await ctx.db.propertyGroup.findUniqueOrThrow({ where: { id: input.id } });
      const siblings = await ctx.db.propertyGroup.findMany({
        where: { eventId: group.eventId },
        orderBy: [{ position: "asc" }, { createdAt: "asc" }],
      });
      const index = siblings.findIndex((sibling) => sibling.id === group.id);
      const swapWith = siblings[input.direction === "up" ? index - 1 : index + 1];
      if (!swapWith) return;
      // Renumber the whole list, so positions stay a clean 0, 1, 2… however
      // groups were made.
      const order = siblings.map((sibling) => sibling.id);
      order[index] = swapWith.id;
      order[siblings.indexOf(swapWith)] = group.id;
      await ctx.db.$transaction(
        order.map((id, position) => ctx.db.propertyGroup.update({ where: { id }, data: { position } })),
      );
    }),

  /** Delete a group. Its properties stay on the list, under "No group". */
  deleteGroup: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(({ ctx, input }) => ctx.db.propertyGroup.delete({ where: { id: input.id } })),

  /** Put a property into a group on this event, or into none with `null`. */
  setGroup: protectedProcedure
    .input(z.object({ id: z.string(), groupId: z.string().nullable() }))
    .mutation(async ({ ctx, input }) => {
      const entry = await ctx.db.scoutingEntry.findUniqueOrThrow({ where: { id: input.id } });
      if (input.groupId) {
        const group = await ctx.db.propertyGroup.findUnique({ where: { id: input.groupId } });
        // A group belongs to one event; a property cannot join another event's.
        if (!group || group.eventId !== entry.eventId) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "That group is not on this event." });
        }
      }
      return ctx.db.scoutingEntry.update({
        where: { id: input.id },
        data: { groupId: input.groupId },
      });
    }),

  listForEvent: protectedProcedure
    .input(
      z.object({
        eventId: z.string(),
        status: z.enum(SCOUTING_STATUSES).optional(),
        type: z.enum(["HOTEL", "APARTMENT", "APARTHOTEL"]).optional(),
        amenityIds: z.array(z.string()).default([]),
        /** One chain's properties on this event (doc §3.9). */
        providerId: z.string().optional(),
      }),
    )
    .query(({ ctx, input }) =>
      ctx.db.scoutingEntry.findMany({
        where: {
          eventId: input.eventId,
          status: input.status,
          property: {
            type: input.type,
            providerId: input.providerId,
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
              provider: { select: { id: true, name: true } },
            },
          },
          addedBy: { select: { name: true, email: true } },
          accountManager: { select: { id: true, name: true, email: true, image: true } },
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
