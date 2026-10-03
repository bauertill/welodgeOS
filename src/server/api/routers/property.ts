import type { Prisma } from "generated/prisma";
import { TRPCError } from "@trpc/server";
import { z } from "zod";

import { contractingFields, propertyDetailFields, propertyServiceFields } from "~/lib/contracting";
import { looksLike, type Scouted } from "~/lib/similar-properties";
import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";
import { geocode, placeDetails, searchPlaces } from "~/server/places";
import { logAudit, logFieldChanges } from "~/server/audit";

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
  indicativePriceMinCents: z.number().int().min(0).optional(),
  indicativePriceMaxCents: z.number().int().min(0).optional(),
  currency: z.string().length(3).default("USD"),
  size: z.string().max(200).optional(),
  notes: z.string().max(2000).optional(),
});

const contactInput = z.object({
  name: z.string().min(1),
  role: z.string().optional(),
  email: z.string().email().optional().or(z.literal("")),
  phone: z.string().optional(),
});

/** The properties a new one looks like (doc §3.1), most alike first. */
async function similarTo(db: Prisma.TransactionClient, scouted: Scouted, excludeId?: string) {
  const all = await db.property.findMany({
    where: excludeId ? { id: { not: excludeId } } : {},
    select: {
      id: true,
      name: true,
      address: true,
      city: true,
      type: true,
      latitude: true,
      longitude: true,
      scoutingEntries: { select: { eventId: true } },
    },
  });
  return all
    .map((property) => ({ ...property, reason: looksLike(scouted, property) }))
    .filter((property): property is typeof property & { reason: string } => property.reason !== null)
    .map(({ scoutingEntries, ...property }) => ({ ...property, eventIds: scoutingEntries.map((entry) => entry.eventId) }))
    .slice(0, 5);
}

const propertyInput = z.object({
  name: z.string().min(1, "A property needs a name"),
  type: z.enum(["HOTEL", "APARTMENT", "APARTHOTEL"]),
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
  // The rest of what the team records about a property (doc §3.9).
  area: z.string().optional(),
  yearBuilt: z.number().int().min(1000).max(2100).optional(),
  generalEmail: z.string().optional(),
  videoUrl: z.string().optional(),
  checkInTime: z.string().optional(),
  checkOutTime: z.string().optional(),
  breakfast: z.string().optional(),
  cleaning: z.string().optional(),
  laundry: z.string().optional(),
  gym: z.string().optional(),
  publicTransport: z.string().optional(),
  tradeName: z.string().optional(),
  vatNumber: z.string().optional(),
  registrationNumber: z.string().optional(),
  iban: z.string().optional(),
  bic: z.string().optional(),
  signatoryName: z.string().optional(),
  signatoryTitle: z.string().optional(),
  contractEmail: z.string().optional(),
  providerId: z.string().nullable().optional(),
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
  // The chain or group, with what a property falls back on (doc §3.9).
  provider: { include: { contacts: { orderBy: { name: "asc" } } } },
} as const;

/** Empty strings arrive from HTML inputs; the database wants nulls. */
const blank = (value: string | undefined) => (value?.trim() ? value.trim() : null);

/** Every free-text field of a property, blanked the same way. */
const textKeys = [
  "address",
  "city",
  "country",
  "website",
  "phone",
  "notes",
  ...propertyDetailFields.map((field) => field.key),
  ...propertyServiceFields.map((field) => field.key),
  ...contractingFields.map((field) => field.key),
] as const;
function cleaned<T extends { providerId?: string | null }>(property: T): T & { providerId: string | null } {
  const record = property as Record<string, unknown>;
  return {
    ...property,
    ...(Object.fromEntries(
      textKeys.map((key) => [key, blank(record[key] as string | undefined)]),
    ) as Partial<T>),
    providerId: property.providerId || null,
  };
}

export const propertyRouter = createTRPCRouter({
  /** Just names, for duplicate detection — a property list is too heavy to fetch on every keystroke. */
  listNames: protectedProcedure.query(({ ctx }) =>
    ctx.db.property.findMany({ select: { id: true, name: true } }),
  ),

  /**
   * Looks an address up on OpenStreetMap so a rep does not have to hunt down
   * coordinates by hand. Called from the server, not the browser, so the
   * request carries the User-Agent Nominatim's usage policy requires — and so
   * the endpoint it hits is not something the client has to know about.
   */
  /** Search Google Maps for a property or an address as it is typed (doc §3.1) — see ~/server/places. */
  placeSearch: protectedProcedure
    .input(z.object({ query: z.string().trim().min(3).max(200), sessionToken: z.string().max(100) }))
    .query(({ input }) => searchPlaces(input.query, input.sessionToken)),

  /** What Google Maps knows of the place picked. */
  placeDetails: protectedProcedure
    .input(z.object({ placeId: z.string().min(1).max(300), sessionToken: z.string().max(100) }))
    .mutation(({ input }) => placeDetails(input.placeId, input.sessionToken)),

  geocode: protectedProcedure
    .input(z.object({ address: z.string().optional(), city: z.string().optional(), country: z.string().optional() }))
    .mutation(({ input }) => geocode([input.address, input.city, input.country])),

  list: protectedProcedure
    .input(
      z
        .object({
          search: z.string().optional(),
          type: z.enum(["HOTEL", "APARTMENT", "APARTHOTEL"]).optional(),
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
          scoutingEntries: { include: { event: true, _count: { select: { quotations: true } } } },
          _count: { select: { contracts: true } },
        },
      }),
    ),

  /** What a property being scouted looks like, among those we have (doc §3.1). */
  similar: protectedProcedure
    .input(
      z.object({
        name: z.string().max(300),
        address: z.string().max(500).optional(),
        latitude: z.number().nullable().optional(),
        longitude: z.number().nullable().optional(),
        excludeId: z.string().optional(),
      }),
    )
    .query(({ ctx, input }) => (input.name.trim().length < 3 && !input.address?.trim() ? [] : similarTo(ctx.db, input, input.excludeId))),

  create: protectedProcedure
    .input(propertyInput.extend({ confirmedDifferent: z.boolean().optional() }))
    .mutation(async ({ ctx, input }) => {
      const { amenityIds, categories, contacts, confirmedDifferent, ...property } = input;

      // The same hotel typed another way is refused too, unless the person
      // scouting it has said it is a different one (doc §3.1).
      if (!confirmedDifferent) {
        const alike = await similarTo(ctx.db, property);
        if (alike.length) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: `This looks like ${alike[0]!.name}, which is already in the system (${alike[0]!.reason}). Use that one, or say it is a different property.`,
          });
        }
      }

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

      return ctx.db.$transaction(async (tx) => {
        const created = await tx.property.create({
          data: {
            ...cleaned(property),
            scoutedById: ctx.session.user.id,
            amenities: { connect: amenityIds.map((id) => ({ id })) },
            categories: {
              create: categories.map(({ id: _unused, ...category }, index) => ({
                ...category,
                size: blank(category.size),
                notes: blank(category.notes),
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
        await logAudit(tx, {
          actorId: ctx.session.user.id,
          entity: "Property",
          entityId: created.id,
          summary: "Added",
        });
        return created;
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
      // A coarse signal, not a field-level diff of every category — nested
      // structures aren't diffed in detail today (doc §4.9).
      const categoriesChanged =
        removing.length > 0 || categories.some((category) => !category.id);

      const [before, existingContacts] = await Promise.all([
        ctx.db.property.findUniqueOrThrow({ where: { id } }),
        ctx.db.propertyContact.findMany({ where: { propertyId: id } }),
      ]);
      // Contacts are always wholesale-replaced below, so "changed" is
      // compared as an order-independent set rather than assumed every time.
      const contactKey = (c: {
        name: string;
        role?: string | null;
        email?: string | null;
        phone?: string | null;
      }) => `${c.name}|${c.role ?? ""}|${c.email ?? ""}|${c.phone ?? ""}`;
      const existingContactKeys = new Set(existingContacts.map(contactKey));
      const incomingContactKeys = new Set(
        contacts.map((c) =>
          contactKey({ ...c, email: blank(c.email), role: blank(c.role), phone: blank(c.phone) }),
        ),
      );
      const contactsChanged =
        existingContactKeys.size !== incomingContactKeys.size ||
        [...existingContactKeys].some((key) => !incomingContactKeys.has(key));

      // Contacts carry nothing downstream, so they stay a wholesale replace.
      return ctx.db.$transaction(async (tx) => {
        await tx.roomCategory.deleteMany({ where: { id: { in: removing } } });
        await tx.propertyContact.deleteMany({ where: { propertyId: id } });

        for (const [index, category] of categories.entries()) {
          const { id: categoryId, ...fields } = category;
          // An emptied size or note is cleared, not left as it was.
          const data = { ...fields, size: blank(fields.size), notes: blank(fields.notes) };
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

        const updated = await tx.property.update({
          where: { id },
          data: {
            ...cleaned(property),
            amenities: { set: amenityIds.map((amenityId) => ({ id: amenityId })) },
            contacts: {
              create: contacts.map((contact) => ({
                ...contact,
                email: blank(contact.email),
              })),
            },
          },
        });

        await logFieldChanges(
          tx,
          { actorId: ctx.session.user.id, entity: "Property", entityId: id, summary: "Updated" },
          before,
          updated,
          [
            { key: "name", label: "Name" },
            { key: "type", label: "Type" },
            { key: "address", label: "Address" },
            { key: "city", label: "City" },
            { key: "country", label: "Country" },
            { key: "stars", label: "Stars" },
            { key: "totalRooms", label: "Total rooms" },
            { key: "website", label: "Website" },
            { key: "phone", label: "Phone" },
            { key: "notes", label: "Notes" },
            { key: "yearBuilt", label: "Year built" },
            { key: "providerId", label: "Provider" },
            ...propertyDetailFields,
            ...propertyServiceFields,
            ...contractingFields,
          ],
        );
        if (categoriesChanged) {
          await logAudit(tx, {
            actorId: ctx.session.user.id,
            entity: "Property",
            entityId: id,
            summary: "Room categories updated",
          });
        }
        if (contactsChanged) {
          await logAudit(tx, {
            actorId: ctx.session.user.id,
            entity: "Property",
            entityId: id,
            summary: "Contacts updated",
          });
        }

        return updated;
      });
    }),

  // --- Editing one card of the property's page in place (doc §3.9) -----------
  // Each saves only what its card shows, so editing contacts can never touch
  // room categories, and the same rules apply as on the full form.

  /** Save some of the property's own fields — whichever the card edited. */
  patch: protectedProcedure
    .input(
      propertyInput
        .omit({ amenityIds: true, categories: true, contacts: true })
        .partial()
        .extend({
          id: z.string(),
          // The full form's optional numbers, clearable from a card.
          latitude: z.number().min(-90).max(90).nullable().optional(),
          longitude: z.number().min(-180).max(180).nullable().optional(),
          yearBuilt: z.number().int().min(1000).max(2100).nullable().optional(),
          totalRooms: z.number().int().min(0).nullable().optional(),
          stars: z.number().int().min(1).max(5).nullable().optional(),
        }),
    )
    .mutation(async ({ ctx, input }) => {
      const { id, ...fields } = input;
      // Coordinates travel as a pair: both, or neither.
      if (fields.latitude !== undefined || fields.longitude !== undefined) {
        const hasLatitude = fields.latitude !== undefined && fields.latitude !== null;
        const hasLongitude = fields.longitude !== undefined && fields.longitude !== null;
        if (hasLatitude !== hasLongitude) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Give both a latitude and a longitude, or neither — one on its own cannot be put on the map.",
          });
        }
      }
      if (fields.name !== undefined) {
        const duplicate = await ctx.db.property.findFirst({
          where: { id: { not: id }, name: { equals: fields.name.trim(), mode: "insensitive" } },
          select: { id: true },
        });
        if (duplicate) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "Cannot add duplicate property — a property with this name already exists." });
        }
      }
      // Only the keys the card sent are written; text is trimmed, and emptied
      // text is cleared rather than left as it was.
      const data: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(fields)) {
        if (value === undefined) continue;
        data[key] = (textKeys as readonly string[]).includes(key) ? blank(value as string) : value;
      }
      if ("providerId" in data) data.providerId = data.providerId || null;

      return ctx.db.$transaction(async (tx) => {
        const before = await tx.property.findUniqueOrThrow({ where: { id } });
        const updated = await tx.property.update({ where: { id }, data });
        await logFieldChanges(
          tx,
          { actorId: ctx.session.user.id, entity: "Property", entityId: id, summary: "Updated" },
          before,
          updated,
          [
            { key: "name", label: "Name" },
            { key: "address", label: "Address" },
            { key: "city", label: "City" },
            { key: "country", label: "Country" },
            { key: "stars", label: "Stars" },
            { key: "totalRooms", label: "Total rooms" },
            { key: "website", label: "Website" },
            { key: "phone", label: "Phone" },
            { key: "notes", label: "Notes" },
            { key: "yearBuilt", label: "Year built" },
            { key: "providerId", label: "Provider" },
            ...propertyDetailFields,
            ...propertyServiceFields,
            ...contractingFields,
          ],
        );
        return updated;
      });
    }),

  setAmenities: protectedProcedure
    .input(z.object({ id: z.string(), amenityIds: z.array(z.string()) }))
    .mutation(async ({ ctx, input }) => {
      const updated = await ctx.db.property.update({
        where: { id: input.id },
        data: { amenities: { set: input.amenityIds.map((amenityId) => ({ id: amenityId })) } },
      });
      await logAudit(ctx.db, { actorId: ctx.session.user.id, entity: "Property", entityId: input.id, summary: "Amenities updated" });
      return updated;
    }),

  setContacts: protectedProcedure
    .input(z.object({ id: z.string(), contacts: z.array(contactInput) }))
    .mutation(({ ctx, input }) =>
      ctx.db.$transaction(async (tx) => {
        await tx.propertyContact.deleteMany({ where: { propertyId: input.id } });
        await tx.propertyContact.createMany({
          data: input.contacts
            .filter((contact) => contact.name.trim())
            .map((contact) => ({
              propertyId: input.id,
              name: contact.name.trim(),
              role: blank(contact.role),
              email: blank(contact.email),
              phone: blank(contact.phone),
            })),
        });
        await logAudit(tx, { actorId: ctx.session.user.id, entity: "Property", entityId: input.id, summary: "Contacts updated" });
      }),
    ),

  /**
   * Add a room category, or change one, from the property's page. The same
   * rule as the full form: a room count cannot drop below the highest room
   * number already in inventory (invariant §4.5.3).
   */
  saveCategory: protectedProcedure
    .input(z.object({ propertyId: z.string(), category: categoryInput }))
    .mutation(async ({ ctx, input }) => {
      const { id, ...fields } = input.category;
      const data = {
        ...fields,
        name: fields.name.trim(),
        // Left out means unchanged; sent empty means cleared.
        bedConfiguration: fields.bedConfiguration === undefined ? undefined : blank(fields.bedConfiguration),
        size: blank(fields.size),
        notes: blank(fields.notes),
      };
      if (id) {
        const highest = await ctx.db.roomSlot.findFirst({
          where: { categoryId: id },
          orderBy: { slotNumber: "desc" },
          select: { slotNumber: true },
        });
        if (highest && data.unitCount < highest.slotNumber) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: `"${data.name}" already has inventory numbered up to #${highest.slotNumber}, so it cannot be reduced to ${data.unitCount} rooms.`,
          });
        }
        const updated = await ctx.db.roomCategory.update({ where: { id }, data });
        await logAudit(ctx.db, { actorId: ctx.session.user.id, entity: "Property", entityId: input.propertyId, summary: "Room categories updated" });
        return updated;
      }
      const last = await ctx.db.roomCategory.aggregate({
        where: { propertyId: input.propertyId },
        _max: { sortOrder: true },
      });
      const created = await ctx.db.roomCategory.create({
        data: { ...data, propertyId: input.propertyId, sortOrder: (last._max.sortOrder ?? -1) + 1 },
      });
      await logAudit(ctx.db, { actorId: ctx.session.user.id, entity: "Property", entityId: input.propertyId, summary: "Room categories updated" });
      return created;
    }),

  /** Remove a room category — refused while inventory is booked against it. */
  removeCategory: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const category = await ctx.db.roomCategory.findUniqueOrThrow({
        where: { id: input.id },
        include: { slots: { include: { _count: { select: { roomNights: true } } } } },
      });
      const nights = category.slots.reduce((sum, slot) => sum + slot._count.roomNights, 0);
      if (nights > 0) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `"${category.name}" cannot be removed: ${nights} room-nights of inventory are booked against it. Release them first, or leave the category in place.`,
        });
      }
      await ctx.db.roomCategory.delete({ where: { id: input.id } });
      await logAudit(ctx.db, { actorId: ctx.session.user.id, entity: "Property", entityId: category.propertyId, summary: "Room categories updated" });
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

      return ctx.db.$transaction(async (tx) => {
        await logAudit(tx, {
          actorId: ctx.session.user.id,
          entity: "Property",
          entityId: input.id,
          summary: "Deleted",
        });
        return tx.property.delete({ where: { id: input.id } });
      });
    }),
});
