import { z } from "zod";

import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";

/**
 * A room category. Hotels fill in `bedConfiguration`; apartments fill in
 * `bedrooms` and `bathrooms`. Both always carry a unit count and a capacity —
 * they are the countable, sellable thing (doc §3.2, §3.3).
 */
const categoryInput = z.object({
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
            create: categories.map((category, index) => ({
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

      // Categories and contacts are replaced wholesale rather than diffed. At
      // scouting scale a property has a handful of each, and nothing downstream
      // references them yet — once Phase 2 hangs room slots off a category this
      // has to become a real diff.
      return ctx.db.$transaction(async (tx) => {
        await tx.roomCategory.deleteMany({ where: { propertyId: id } });
        await tx.propertyContact.deleteMany({ where: { propertyId: id } });

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
            categories: {
              create: categories.map((category, index) => ({
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
      });
    }),

  remove: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(({ ctx, input }) =>
      ctx.db.property.delete({ where: { id: input.id } }),
    ),
});
