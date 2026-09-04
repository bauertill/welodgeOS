import { TRPCError } from "@trpc/server";
import { z } from "zod";

import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";

/**
 * A room category. Hotels fill in `bedConfiguration`; apartments fill in
 * `bedrooms` and `bathrooms`. Both always carry a unit count and a capacity —
 * they are the countable, sellable thing (doc §3.2, §3.3).
 */
const categoryInput = z.object({
  /** Present when the category already exists. Room slots hang off this id, so
   * an edit must keep it rather than replacing the row (doc §2.1). */
  id: z.string().optional(),
  name: z.string().min(1, "Give the category a name"),
  unitCount: z.number().int().min(0),
  capacity: z.number().int().min(1),
  bedConfiguration: z.string().optional(),
  bedrooms: z.number().int().min(0).optional(),
  bathrooms: z.number().min(0).optional(),
  indicativePriceCents: z.number().int().min(0).optional(),
  currency: z.string().length(3).default("CHF"),
});

const contactInput = z.object({
  name: z.string().min(1),
  role: z.string().optional(),
  email: z.string().email().optional().or(z.literal("")),
  phone: z.string().optional(),
});

const propertyInput = z.object({
  name: z.string().min(1, "A property needs a name"),
  type: z.enum(["HOTEL", "APARTMENT"]),
  address: z.string().optional(),
  city: z.string().optional(),
  country: z.string().optional(),
  latitude: z.number().min(-90).max(90).optional(),
  longitude: z.number().min(-180).max(180).optional(),
  stars: z.number().int().min(1).max(5).optional(),
  totalRooms: z.number().int().min(0).optional(),
  website: z.string().optional(),
  phone: z.string().optional(),
  notes: z.string().optional(),
  amenityIds: z.array(z.string()).default([]),
  categories: z.array(categoryInput).default([]),
  contacts: z.array(contactInput).default([]),
});

/** Everything a property card or row needs, in one shape. */
const detail = {
  categories: { orderBy: { sortOrder: "asc" } },
  contacts: { orderBy: { name: "asc" } },
  amenities: { orderBy: { sortOrder: "asc" } },
  scoutedBy: { select: { name: true, email: true } },
} as const;

/** Empty strings arrive from HTML inputs; the database wants nulls. */
const blank = (value: string | undefined) => (value?.trim() ? value.trim() : null);

export const propertyRouter = createTRPCRouter({
  /** Just names, for duplicate detection — a property list is too heavy to fetch on every keystroke. */
  listNames: protectedProcedure.query(({ ctx }) =>
    ctx.db.property.findMany({ select: { id: true, name: true } }),
  ),

  list: protectedProcedure
    .input(
      z
        .object({
          search: z.string().optional(),
          type: z.enum(["HOTEL", "APARTMENT"]).optional(),
        })
        .default({}),
    )
    .query(({ ctx, input }) =>
      ctx.db.property.findMany({
        where: {
          type: input.type,
          ...(input.search
            ? {
                OR: [
                  { name: { contains: input.search, mode: "insensitive" } },
                  { city: { contains: input.search, mode: "insensitive" } },
                ],
              }
            : {}),
        },
        orderBy: { name: "asc" },
        include: {
          ...detail,
          _count: { select: { scoutingEntries: true } },
        },
      }),
    ),

  byId: protectedProcedure
    .input(z.object({ id: z.string() }))
    .query(({ ctx, input }) =>
      ctx.db.property.findUnique({
        where: { id: input.id },
        include: {
          ...detail,
          scoutingEntries: { include: { event: true } },
        },
      }),
    ),

  create: protectedProcedure
    .input(propertyInput)
    .mutation(async ({ ctx, input }) => {
      const { amenityIds, categories, contacts, ...property } = input;

      const duplicate = await ctx.db.property.findFirst({
        where: { name: { equals: property.name.trim(), mode: "insensitive" } },
        select: { id: true },
      });
      if (duplicate) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            "Cannot add duplicate property — a property with this name already exists.",
        });
      }

      return ctx.db.property.create({
        data: {
          ...property,
          address: blank(property.address),
          city: blank(property.city),
          country: blank(property.country),
          website: blank(property.website),
          phone: blank(property.phone),
          notes: blank(property.notes),
          scoutedById: ctx.session.user.id,
          amenities: { connect: amenityIds.map((id) => ({ id })) },
          categories: {
            create: categories.map(({ id: _unused, ...category }, index) => ({
              ...category,
              sortOrder: index,
            })),
          },
          contacts: {
            create: contacts.map((contact) => ({
              ...contact,
              email: blank(contact.email),
            })),
          },
        },
      });
    }),

  update: protectedProcedure
    .input(propertyInput.extend({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const { id, amenityIds, categories, contacts, ...property } = input;

      const duplicate = await ctx.db.property.findFirst({
        where: {
          id: { not: id },
          name: { equals: property.name.trim(), mode: "insensitive" },
        },
        select: { id: true },
      });
      if (duplicate) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            "Cannot add duplicate property — a property with this name already exists.",
        });
      }

      // Room slots — and every room-night on them — hang off a category, so a
      // category is edited in place, never replaced. Removing one that already
      // carries inventory would take the inventory with it, which is why it is
      // refused rather than done quietly.
      const existing = await ctx.db.roomCategory.findMany({
        where: { propertyId: id },
        include: {
          slots: {
            orderBy: { slotNumber: "desc" },
            include: { _count: { select: { roomNights: true } } },
          },
        },
      });

      const keeping = new Set(
        categories.map((category) => category.id).filter(Boolean),
      );

      for (const category of existing) {
        const nights = category.slots.reduce(
          (sum, slot) => sum + slot._count.roomNights,
          0,
        );
        const highestSlot = category.slots[0]?.slotNumber ?? 0;

        if (!keeping.has(category.id) && nights > 0) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: `"${category.name}" cannot be removed: ${nights} room-nights of inventory are booked against it. Release them first, or leave the category in place.`,
          });
        }

        // Invariant §4.5.3 — slot numbers may not exceed the category's count.
        const incoming = categories.find((c) => c.id === category.id);
        if (incoming && incoming.unitCount < highestSlot) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: `"${category.name}" already has inventory numbered up to #${highestSlot}, so it cannot be reduced to ${incoming.unitCount} rooms.`,
          });
        }
      }

      const removing = existing
        .filter((category) => !keeping.has(category.id))
        .map((category) => category.id);

      // Contacts carry nothing downstream, so they stay a wholesale replace.
      return ctx.db.$transaction(async (tx) => {
        await tx.roomCategory.deleteMany({ where: { id: { in: removing } } });
        await tx.propertyContact.deleteMany({ where: { propertyId: id } });

        for (const [index, category] of categories.entries()) {
          const { id: categoryId, ...data } = category;
          if (categoryId) {
            await tx.roomCategory.update({
              where: { id: categoryId },
              data: { ...data, sortOrder: index },
            });
          } else {
            await tx.roomCategory.create({
              data: { ...data, sortOrder: index, propertyId: id },
            });
          }
        }

        return tx.property.update({
          where: { id },
          data: {
            ...property,
            address: blank(property.address),
            city: blank(property.city),
            country: blank(property.country),
            website: blank(property.website),
            phone: blank(property.phone),
            notes: blank(property.notes),
            amenities: { set: amenityIds.map((amenityId) => ({ id: amenityId })) },
            contacts: {
              create: contacts.map((contact) => ({
                ...contact,
                email: blank(contact.email),
              })),
            },
          },
        });
      });
    }),

  remove: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      // Deleting the property here removes it from the shared library for
      // every event, not just one — so it is refused while anything still
      // depends on it, rather than silently taking those events' lists and
      // inventory down with it.
      const [scoutingCount, categories] = await Promise.all([
        ctx.db.scoutingEntry.count({ where: { propertyId: input.id } }),
        ctx.db.roomCategory.findMany({
          where: { propertyId: input.id },
          include: { slots: { include: { _count: { select: { roomNights: true } } } } },
        }),
      ]);

      if (scoutingCount > 0) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `This property is still on ${scoutingCount === 1 ? "an event's" : `${scoutingCount} events'`} scouting list. Remove it from every list first.`,
        });
      }

      const nights = categories.reduce(
        (sum, category) =>
          sum +
          category.slots.reduce((s, slot) => s + slot._count.roomNights, 0),
        0,
      );
      if (nights > 0) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            "This property carries booked inventory and cannot be deleted.",
        });
      }

      return ctx.db.property.delete({ where: { id: input.id } });
    }),
});
