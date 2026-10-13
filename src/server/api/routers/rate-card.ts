import { randomBytes } from "crypto";
import type { Prisma, PrismaClient } from "generated/prisma";
import { TRPCError } from "@trpc/server";
import { z } from "zod";

import { env } from "~/env";
import { nightsBetween, parseDay } from "~/lib/dates";
import { clientMedia, photoSrc } from "~/lib/media";
import { measuredPlaces, nearestPlace } from "~/lib/scouting";
import { createTRPCRouter, protectedProcedure, publicProcedure } from "~/server/api/trpc";
import { moveStage } from "~/server/api/routers/sales";
import { legsForMode } from "~/server/api/routers/travel";
import { logAudit } from "~/server/audit";
import { ensureGetMediaTask, GET_MEDIA, hasMedia, withMedia } from "~/server/get-media";
import { deliverImmediate, notify } from "~/server/notify";
import { eventRates } from "~/server/event-rates";

/**
 * Rate cards (doc §4.11): what we offer a client for a sales request — the
 * properties chosen on its sourcing task, each room category at the rate we
 * sell it for. Our buying rate (the event rate, §3.9) is kept beside each, for
 * us; the client's copy — by link, or printed — never shows it.
 */

type Db = Prisma.TransactionClient | PrismaClient;

const DEFAULT_MARKUP = 1500; // 15.00%
/** How many of a property's photos a new card shows to start. */
const CARD_PHOTOS = 6;
const withMarkup = (cents: number, basisPoints: number) => Math.round((cents * (10_000 + basisPoints)) / 10_000);

const answerInclude = { orderBy: { createdAt: "desc" }, include: { items: true } } satisfies Prisma.RateCard$responsesArgs;

const cardInclude = {
  responses: answerInclude,
  salesRequest: {
    select: {
      id: true,
      ownerId: true,
      client: { select: { name: true } },
      event: { select: { id: true, name: true, startDate: true, endDate: true, placesOfInterest: {
            select: { id: true, name: true, category: true, notes: true, latitude: true, longitude: true, layer: { select: { measured: true, name: true, color: true } } },
          },
        },
      },
      lines: { orderBy: { position: "asc" } },
    },
  },
  properties: {
    orderBy: { position: "asc" },
    include: {
      property: {
        select: {
          id: true,
          name: true,
          type: true,
          stars: true,
          city: true,
          area: true,
          latitude: true,
          longitude: true,
          website: true,
          videoUrl: true,
          photosUrl: true,
          photos: { orderBy: [{ position: "asc" }, { createdAt: "asc" }], include: { category: { select: { name: true } } } },
          tasks: { where: { status: { not: "DONE" }, type: { name: GET_MEDIA } }, select: { id: true }, take: 1 },
        },
      },
      lines: { orderBy: { position: "asc" } },
      photos: { orderBy: { position: "asc" }, select: { photoId: true } },
    },
  },
} satisfies Prisma.RateCardInclude;
type LoadedCard = Prisma.RateCardGetPayload<{ include: typeof cardInclude }>;

/** The card as it is read: each property with how far it is from the nearest venue (worked out, never stored). */
function shape(card: LoadedCard) {
  const places = card.salesRequest.event?.placesOfInterest ?? [];
  const venues = measuredPlaces(places);
  return {
    id: card.id,
    name: card.name,
    currency: card.currency,
    markupBasisPoints: card.markupBasisPoints,
    intro: card.intro,
    shareToken: card.shareToken,
    updatedAt: card.updatedAt,
    clientName: card.salesRequest.client.name,
    /** The client's answers from its link, newest first (doc §4.11). */
    answers: card.responses.map((response) => ({
      id: response.id,
      at: response.createdAt,
      isNew: response.seenAt === null,
      name: response.name,
      email: response.email,
      note: response.note,
      datesChanged: response.datesChanged,
      newCheckIn: response.newCheckIn,
      newCheckOut: response.newCheckOut,
      datesNote: response.datesNote,
      items: response.items.map((item) => ({
        id: item.id,
        lineId: item.lineId,
        propertyName: item.propertyName,
        roomName: item.roomName,
        sellingCents: item.sellingCents,
        rooms: item.rooms,
        checkIn: item.checkIn,
        checkOut: item.checkOut,
        note: item.note,
      })),
    })),
    salesRequestId: card.salesRequest.id,
    event: card.salesRequest.event ? { name: card.salesRequest.event.name, startDate: card.salesRequest.event.startDate, endDate: card.salesRequest.event.endDate } : null,
    asked: card.salesRequest.lines.map((line) => ({ rooms: line.rooms, roomType: line.roomType, checkIn: line.checkIn, checkOut: line.checkOut })),
    venues: venues.map((place) => ({
      id: place.id,
      name: place.name,
      category: place.category,
      notes: place.notes,
      layerName: place.layer?.name ?? null,
      color: place.layer?.color ?? null,
      latitude: place.latitude,
      longitude: place.longitude,
    })),
    properties: card.properties.map((entry) => {
      const from = entry.property.latitude !== null && entry.property.longitude !== null ? { latitude: entry.property.latitude, longitude: entry.property.longitude } : null;
      const nearest = nearestPlace(from, venues.length ? venues : places);
      return {
        id: entry.id,
        propertyId: entry.property.id,
        name: entry.property.name,
        type: entry.property.type,
        stars: entry.property.stars,
        where: entry.property.area ?? entry.property.city,
        website: entry.property.website,
        latitude: entry.property.latitude,
        longitude: entry.property.longitude,
        nearest: nearest ? { name: nearest.place.name, km: nearest.km } : null,
        description: entry.description,
        videoUrl: entry.property.videoUrl,
        photosUrl: entry.property.photosUrl,
        /** Every photo picked for clients on the property (doc §3.9, Media) … */
        allPhotos: entry.property.photos.map((photo) => ({
          id: photo.id,
          url: photo.url,
          src: photoSrc(photo.url),
          caption: photo.caption,
          categoryId: photo.categoryId,
          categoryName: photo.category?.name ?? null,
        })),
        /** … and those this card shows, in order. */
        photoIds: entry.photos.map((photo) => photo.photoId),
        /** No video, photos folder or photo: the card is not shared until it has (doc §4.11). */
        hasMedia: Boolean(entry.property.videoUrl?.trim() || entry.property.photosUrl?.trim() || entry.property.photos.length),
        getMediaTaskId: entry.property.tasks[0]?.id ?? null,
        lines: entry.lines.map((line) => ({
          id: line.id,
          categoryId: line.categoryId,
          name: line.name,
          sleeps: line.sleeps,
          buyingCents: line.buyingCents,
          sellingCents: line.sellingCents,
          available: line.available,
          minNights: line.minNights,
        })),
      };
    }),
  };
}

async function loadCard(db: Db, where: Prisma.RateCardWhereUniqueInput) {
  const card = await db.rateCard.findUnique({ where, include: cardInclude });
  return card ? shape(card) : null;
}

export const rateCardRouter = createTRPCRouter({
  /** A new card from the properties ticked on a sourcing task: every room category, bought at its event rate, sold at it plus the markup. */
  create: protectedProcedure
    .input(z.object({ salesRequestId: z.string(), propertyIds: z.array(z.string()).min(1, "Tick at least one property.").max(30) }))
    .mutation(async ({ ctx, input }) => {
      return ctx.db.$transaction(async (tx) => {
        const request = await tx.salesRequest.findUniqueOrThrow({
          where: { id: input.salesRequestId },
          select: { eventId: true, budgetCurrency: true, client: { select: { name: true } }, event: { select: { name: true } }, _count: { select: { rateCards: true } } },
        });
        const properties = await tx.property.findMany({
          where: { id: { in: input.propertyIds } },
          select: {
            id: true,
            ...withMedia,
            categories: { orderBy: { sortOrder: "asc" }, select: { id: true, name: true, capacity: true, unitCount: true } },
            photos: { orderBy: [{ position: "asc" }, { createdAt: "asc" }], take: CARD_PHOTOS, select: { id: true } },
          },
        });
        const rates = request.eventId ? (await eventRates(tx, { propertyIds: input.propertyIds, eventId: request.eventId })).get(request.eventId) : undefined;
        const currency = request.budgetCurrency ?? [...(rates?.values() ?? [])][0]?.currency ?? "USD";
        const card = await tx.rateCard.create({
          data: {
            name: `Rate card${request._count.rateCards ? ` ${request._count.rateCards + 1}` : ""} — ${request.client.name}${request.event ? ` — ${request.event.name}` : ""}`,
            salesRequestId: input.salesRequestId,
            currency,
            markupBasisPoints: DEFAULT_MARKUP,
            createdById: ctx.session.user.id,
            properties: {
              create: input.propertyIds
                .map((id) => properties.find((property) => property.id === id))
                .filter((property): property is (typeof properties)[number] => Boolean(property))
                .map((property, position) => ({
                  propertyId: property.id,
                  position,
                  // The property's first photos to start; the team changes the choice on the card.
                  photos: { create: property.photos.map((photo, index) => ({ photoId: photo.id, position: index })) },
                  lines: {
                    create: property.categories.map((category, index) => {
                      const rate = rates?.get(category.id);
                      const buying = rate && rate.currency === currency ? rate.minCents : null;
                      return {
                        categoryId: category.id,
                        name: category.name,
                        sleeps: category.capacity,
                        buyingCents: buying,
                        sellingCents: buying === null ? null : withMarkup(buying, DEFAULT_MARKUP),
                        position: index,
                      };
                    }),
                  },
                })),
            },
          },
        });
        await logAudit(tx, { actorId: ctx.session.user.id, entity: "SalesRequest", entityId: input.salesRequestId, summary: `Rate card made: ${card.name}` });
        // Any property with no photos or video yet: a task to get them, as the card cannot be shared without (doc §4.11).
        for (const property of properties.filter((one) => !hasMedia(one))) {
          await ensureGetMediaTask(tx, { propertyId: property.id, salesRequestId: input.salesRequestId, actorId: ctx.session.user.id });
        }
        return { id: card.id };
      });
    }),

  /** A sales request's rate cards, newest first. */
  forRequest: protectedProcedure.input(z.object({ salesRequestId: z.string() })).query(({ ctx, input }) =>
    ctx.db.rateCard.findMany({
      where: { salesRequestId: input.salesRequestId },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        name: true,
        createdAt: true,
        updatedAt: true,
        shareToken: true,
        _count: { select: { properties: true, responses: true } },
        responses: { where: { seenAt: null }, select: { id: true } },
      },
    }),
  ),

  /** How many requests have an answer from the client nobody in the team has opened yet — the red count on Sales (doc §4.11). */
  newAnswers: protectedProcedure.query(async ({ ctx }) => {
    const unseen = await ctx.db.rateCardResponse.findMany({ where: { seenAt: null }, select: { rateCard: { select: { salesRequestId: true } } } });
    return { requests: new Set(unseen.map((response) => response.rateCard.salesRequestId)).size };
  }),

  /**
   * Every answer the client sent on this request's rate cards, newest first —
   * what the request's page puts at its top (doc §4.11).
   */
  answersForRequest: protectedProcedure.input(z.object({ salesRequestId: z.string() })).query(async ({ ctx, input }) => {
    const responses = await ctx.db.rateCardResponse.findMany({
      where: { rateCard: { salesRequestId: input.salesRequestId } },
      orderBy: { createdAt: "desc" },
      include: { items: true, rateCard: { select: { id: true, name: true, currency: true } } },
    });
    return responses.map((response) => ({
      id: response.id,
      at: response.createdAt,
      isNew: response.seenAt === null,
      card: response.rateCard,
      name: response.name,
      email: response.email,
      note: response.note,
      datesChanged: response.datesChanged,
      newCheckIn: response.newCheckIn,
      newCheckOut: response.newCheckOut,
      datesNote: response.datesNote,
      items: response.items.map((item) => ({
        id: item.id,
        propertyName: item.propertyName,
        roomName: item.roomName,
        sellingCents: item.sellingCents,
        rooms: item.rooms,
        checkIn: item.checkIn,
        checkOut: item.checkOut,
        note: item.note,
      })),
    }));
  }),

  /** The request's answers have been read — seeing them on its page does it. */
  markRequestSeen: protectedProcedure.input(z.object({ salesRequestId: z.string() })).mutation(async ({ ctx, input }) => {
    await ctx.db.rateCardResponse.updateMany({ where: { rateCard: { salesRequestId: input.salesRequestId }, seenAt: null }, data: { seenAt: new Date() } });
    return { ok: true };
  }),

  /** The card's answers have been read — opening the card does it. */
  markSeen: protectedProcedure.input(z.object({ id: z.string() })).mutation(async ({ ctx, input }) => {
    await ctx.db.rateCardResponse.updateMany({ where: { rateCardId: input.id, seenAt: null }, data: { seenAt: new Date() } });
    return { ok: true };
  }),

  byId: protectedProcedure.input(z.object({ id: z.string() })).query(async ({ ctx, input }) => {
    const card = await loadCard(ctx.db, { id: input.id });
    if (!card) throw new TRPCError({ code: "NOT_FOUND", message: "This rate card no longer exists." });
    return card;
  }),

  /** The card as edited: its name and word to the client, the markup last applied, each property's description and each selling rate. */
  save: protectedProcedure
    .input(
      z.object({
        id: z.string(),
        name: z.string().trim().min(1, "Give the rate card a name.").max(200),
        intro: z.string().max(3000),
        markupBasisPoints: z.number().int().min(-10_000).max(100_000).nullable(),
        properties: z
          .array(
            z.object({
              id: z.string(),
              description: z.string().max(3000),
              /** The property's photos this card shows, in order. */
              photoIds: z.array(z.string()).max(60).optional(),
              lines: z
                .array(
                  z.object({
                    id: z.string(),
                    sellingCents: z.number().int().min(0).nullable(),
                    available: z.number().int().min(1, "Units available has to be at least 1.").max(10_000).nullable(),
                    minNights: z.number().int().min(1, "The minimum stay has to be at least 1 night.").max(365).nullable(),
                  }),
                )
                .max(60),
            }),
          )
          .max(30),
        /** Taken off the card. */
        removedPropertyIds: z.array(z.string()).max(30).default([]),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      // A room is only offered with how many units there are and the shortest stay (doc §4.11).
      for (const property of input.properties) {
        if (input.removedPropertyIds.includes(property.id)) continue;
        if (property.lines.some((line) => line.sellingCents !== null && (line.available === null || line.minNights === null))) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "For every room offered, say how many units are available and the minimum stay." });
        }
      }
      await ctx.db.$transaction(async (tx) => {
        const card = await tx.rateCard.findUniqueOrThrow({ where: { id: input.id }, select: { id: true, salesRequestId: true, properties: { select: { id: true, lines: { select: { id: true } } } } } });
        const ownProperties = new Set(card.properties.map((property) => property.id));
        const ownLines = new Set(card.properties.flatMap((property) => property.lines.map((line) => line.id)));
        await tx.rateCard.update({
          where: { id: card.id },
          data: { name: input.name, intro: input.intro.trim() || null, markupBasisPoints: input.markupBasisPoints },
        });
        if (input.removedPropertyIds.length) {
          await tx.rateCardProperty.deleteMany({ where: { id: { in: input.removedPropertyIds.filter((id) => ownProperties.has(id)) } } });
        }
        for (const [position, property] of input.properties.entries()) {
          if (!ownProperties.has(property.id) || input.removedPropertyIds.includes(property.id)) continue;
          await tx.rateCardProperty.update({ where: { id: property.id }, data: { description: property.description.trim() || null, position } });
          if (property.photoIds) {
            const entry = await tx.rateCardProperty.findUniqueOrThrow({ where: { id: property.id }, select: { property: { select: { photos: { select: { id: true } } } } } });
            const own = new Set(entry.property.photos.map((photo) => photo.id));
            await tx.rateCardPhoto.deleteMany({ where: { rateCardPropertyId: property.id } });
            await tx.rateCardPhoto.createMany({
              data: property.photoIds.filter((id) => own.has(id)).map((photoId, index) => ({ rateCardPropertyId: property.id, photoId, position: index })),
            });
          }
          for (const line of property.lines) {
            if (!ownLines.has(line.id)) continue;
            await tx.rateCardLine.update({ where: { id: line.id }, data: { sellingCents: line.sellingCents, available: line.available, minNights: line.minNights } });
          }
        }
        await logAudit(tx, { actorId: ctx.session.user.id, entity: "SalesRequest", entityId: card.salesRequestId, summary: `Rate card saved: ${input.name}` });
      });
      return { ok: true };
    }),

  remove: protectedProcedure.input(z.object({ id: z.string() })).mutation(async ({ ctx, input }) => {
    const card = await ctx.db.rateCard.delete({ where: { id: input.id } });
    await logAudit(ctx.db, { actorId: ctx.session.user.id, entity: "SalesRequest", entityId: card.salesRequestId, summary: `Rate card deleted: ${card.name}` });
    return { ok: true };
  }),

  /** A link for the client — no sign-in, no buying rates. A new one replaces the old. */
  share: protectedProcedure.input(z.object({ id: z.string() })).mutation(async ({ ctx, input }) => {
    const missing = await ctx.db.rateCardLine.count({
      where: { rateCardProperty: { rateCardId: input.id }, sellingCents: { not: null }, OR: [{ available: null }, { minNights: null }] },
    });
    if (missing) throw new TRPCError({ code: "BAD_REQUEST", message: "Say how many units are available and the minimum stay for every room offered, and save, before making the link." });
    // Clients have to see what each property looks like (doc §4.11).
    const bare = (
      await ctx.db.rateCardProperty.findMany({ where: { rateCardId: input.id }, select: { property: { select: { name: true, ...withMedia } } } })
    ).filter((entry) => !hasMedia(entry.property));
    if (bare.length) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: `${bare.map((entry) => entry.property.name).join(", ")} ${bare.length === 1 ? "has" : "have"} no photos or video yet — the card can be shared once ${bare.length === 1 ? "it has" : "they have"} (see the Get media task).`,
      });
    }
    // Making the link is sending the proposal: a request at Initial interest or Specify moves to Proposal sent (doc §4.11).
    return ctx.db.$transaction(async (tx) => {
      const card = await tx.rateCard.update({
        where: { id: input.id },
        data: { shareToken: randomBytes(24).toString("base64url") },
        select: { shareToken: true, salesRequestId: true, name: true, salesRequest: { select: { stage: true } } },
      });
      await logAudit(tx, { actorId: ctx.session.user.id, entity: "SalesRequest", entityId: card.salesRequestId, summary: `Rate card link made: ${card.name}` });
      const early = card.salesRequest.stage === "INITIAL_INTEREST" || card.salesRequest.stage === "SPECIFY";
      if (early) await moveStage(tx, ctx.session.user.id, card.salesRequestId, "PROPOSAL_SENT");
      return { shareToken: card.shareToken!, movedToProposal: early };
    });
  }),

  unshare: protectedProcedure.input(z.object({ id: z.string() })).mutation(async ({ ctx, input }) => {
    await ctx.db.rateCard.update({ where: { id: input.id }, data: { shareToken: null } });
    return { ok: true };
  }),

  /**
   * Getting from one of the card's properties to one of its venues (doc §4.11),
   * on the client's link: walking, by car and by public transport, from
   * Google — asked when the client asks, never stored.
   */
  journey: publicProcedure
    .input(z.object({ token: z.string().min(20).max(100), rateCardPropertyId: z.string(), placeId: z.string() }))
    .query(async ({ ctx, input }) => {
      const key = env.GOOGLE_MAPS_SERVER_KEY;
      if (!key) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Travel times are not available right now." });
      const card = await ctx.db.rateCard.findUnique({
        where: { shareToken: input.token },
        select: {
          salesRequest: { select: { eventId: true } },
          properties: { where: { id: input.rateCardPropertyId }, select: { property: { select: { latitude: true, longitude: true } } } },
        },
      });
      const from = card?.properties[0]?.property;
      const place = await ctx.db.placeOfInterest.findFirst({
        where: { id: input.placeId, eventId: card?.salesRequest.eventId ?? "none" },
        select: { latitude: true, longitude: true },
      });
      if (!from?.latitude || !from.longitude || !place) throw new TRPCError({ code: "NOT_FOUND", message: "That journey cannot be worked out." });
      const origin = { latitude: from.latitude, longitude: from.longitude };
      const [walk, car, transit] = await Promise.all(
        (["WALK", "DRIVE", "TRANSIT"] as const).map((mode) => legsForMode(mode, origin, [place], key).then((legs) => legs[0] ?? null).catch(() => null)),
      );
      return { walk, car, transit };
    }),

  /** The client's copy, by its link: everything but our buying rates, and only the rates offered. */
  shared: publicProcedure.input(z.object({ token: z.string().min(20).max(100) })).query(async ({ ctx, input }) => {
    const card = await loadCard(ctx.db, { shareToken: input.token });
    if (!card) throw new TRPCError({ code: "NOT_FOUND", message: "This rate card is not shared any more." });
    return clientCopy(card);
  }),

  /**
   * The client answers from the link (doc §4.11): the rooms they are
   * interested in — how many, which nights, a note — and, if so, that their
   * dates have changed. Kept as sent; the request's account manager and
   * whoever made the card are told.
   */
  answer: publicProcedure
    .input(
      z.object({
        token: z.string().min(20).max(100),
        name: z.string().trim().max(200),
        email: z.string().trim().max(300),
        note: z.string().max(3000),
        dateChange: z.object({ checkIn: z.string().max(10), checkOut: z.string().max(10), note: z.string().max(2000) }).nullable(),
        items: z
          .array(
            z.object({
              lineId: z.string(),
              rooms: z.number().int().min(1, "Say how many rooms.").max(5000),
              checkIn: z.string().max(10),
              checkOut: z.string().max(10),
              note: z.string().max(2000),
            }),
          )
          .max(100),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const day = (text: string) => (/^\d{4}-\d{2}-\d{2}$/.test(text) ? parseDay(text) : null);
      if (input.email && !/^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test(input.email)) throw new TRPCError({ code: "BAD_REQUEST", message: "That email address does not look right." });
      if (input.items.length === 0 && !input.dateChange && !input.note.trim()) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Choose the rooms you are interested in, tell us your new dates, or leave a note." });
      }
      for (const item of input.items) {
        const from = day(item.checkIn);
        const to = day(item.checkOut);
        if (from && to && to <= from) throw new TRPCError({ code: "BAD_REQUEST", message: "Each departure has to be after its arrival." });
      }
      const result = await ctx.db.$transaction(async (tx) => {
        const card = await tx.rateCard.findUnique({
          where: { shareToken: input.token },
          select: {
            id: true,
            name: true,
            createdById: true,
            salesRequest: { select: { id: true, ownerId: true, client: { select: { name: true } } } },
            properties: { select: { property: { select: { name: true } }, lines: { select: { id: true, name: true, sellingCents: true, available: true, minNights: true } } } },
          },
        });
        if (!card) throw new TRPCError({ code: "NOT_FOUND", message: "This rate card is not shared any more." });
        const lines = new Map(card.properties.flatMap((property) => property.lines.map((line) => [line.id, { ...line, propertyName: property.property.name }] as const)));
        const items = input.items.filter((item) => lines.has(item.lineId));
        for (const item of items) {
          const line = lines.get(item.lineId)!;
          if (line.available !== null && item.rooms > line.available) {
            throw new TRPCError({ code: "BAD_REQUEST", message: `${line.propertyName}, ${line.name}: ${line.available} available at most.` });
          }
          const from = day(item.checkIn);
          const to = day(item.checkOut);
          if (line.minNights !== null && from && to && nightsBetween(from, to) < line.minNights) {
            throw new TRPCError({ code: "BAD_REQUEST", message: `${line.propertyName}, ${line.name}: the minimum stay is ${line.minNights} nights.` });
          }
        }
        const response = await tx.rateCardResponse.create({
          data: {
            rateCardId: card.id,
            name: input.name || null,
            email: input.email || null,
            note: input.note.trim() || null,
            datesChanged: Boolean(input.dateChange),
            newCheckIn: input.dateChange ? day(input.dateChange.checkIn) : null,
            newCheckOut: input.dateChange ? day(input.dateChange.checkOut) : null,
            datesNote: input.dateChange?.note.trim() || null,
            items: {
              create: items.map((item) => {
                const line = lines.get(item.lineId)!;
                return {
                  lineId: line.id,
                  propertyName: line.propertyName,
                  roomName: line.name,
                  sellingCents: line.sellingCents,
                  rooms: item.rooms,
                  checkIn: day(item.checkIn),
                  checkOut: day(item.checkOut),
                  note: item.note.trim() || null,
                };
              }),
            },
          },
        });
        const said = [
          items.length ? roomsInWords(items) : null,
          input.dateChange ? "their dates have changed" : null,
        ]
          .filter(Boolean)
          .join(", and ");
        await logAudit(tx, {
          actorId: null,
          entity: "SalesRequest",
          entityId: card.salesRequest.id,
          summary: `Rate card answered by the client: ${card.name}`,
          changes: said || input.note.trim() || null,
        });
        await notify(tx, {
          to: [card.salesRequest.ownerId, card.createdById],
          actorId: null,
          kind: "RATE_CARD_ANSWERED",
          title: `${card.salesRequest.client.name} answered the rate card${said ? `: ${said}` : ""}`,
          body: input.note.trim() || null,
          link: `/sales/${card.salesRequest.id}`,
        });
        return { id: response.id };
      });
      await deliverImmediate(ctx.db);
      return result;
    }),

  /**
   * A short description of a property for the card, written — or a draft
   * polished — by Claude from what we know of it. Needs ANTHROPIC_API_KEY.
   */
  describe: protectedProcedure
    .input(z.object({ rateCardPropertyId: z.string(), draft: z.string().max(3000) }))
    .mutation(async ({ ctx, input }) => {
      const key = env.ANTHROPIC_API_KEY;
      if (!key) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "The writing helper needs an AI key (ANTHROPIC_API_KEY) — Till can add it." });
      const entry = await ctx.db.rateCardProperty.findUniqueOrThrow({
        where: { id: input.rateCardPropertyId },
        include: {
          rateCard: { include: cardInclude },
          property: {
            select: {
              name: true,
              type: true,
              stars: true,
              city: true,
              area: true,
              yearBuilt: true,
              breakfast: true,
              gym: true,
              publicTransport: true,
              amenities: { select: { label: true } },
              categories: { select: { name: true, unitCount: true, size: true } },
            },
          },
        },
      });
      const card = shape(entry.rateCard);
      const here = card.properties.find((property) => property.id === entry.id);
      const p = entry.property;
      const facts = [
        `Name: ${p.name}`,
        `Kind: ${p.type.toLowerCase()}${p.stars ? `, ${p.stars} stars` : ""}`,
        p.area || p.city ? `Where: ${[p.area, p.city].filter(Boolean).join(", ")}` : null,
        here?.nearest ? `Distance: ${here.nearest.km.toFixed(1)} km from ${here.nearest.name}` : null,
        p.yearBuilt ? `Built: ${p.yearBuilt}` : null,
        p.amenities.length ? `Amenities: ${p.amenities.map((amenity) => amenity.label).join(", ")}` : null,
        p.categories.length ? `Room types: ${p.categories.map((category) => `${category.name}${category.size ? ` (${category.size})` : ""}`).join(", ")}` : null,
        p.breakfast ? `Breakfast: ${p.breakfast}` : null,
        p.gym ? `Gym: ${p.gym}` : null,
        p.publicTransport ? `Public transport: ${p.publicTransport}` : null,
      ]
        .filter(Boolean)
        .join("\n");
      const response = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" },
        body: JSON.stringify({
          model: "claude-sonnet-5",
          max_tokens: 300,
          system:
            "You write short property descriptions for a rate card that an accommodation agency sends to corporate clients (sports federations, broadcasters, sponsors) for a major event. Two or three plain, factual sentences, no more than 60 words, warm but not salesy, in British English. Use only the facts given — never invent amenities, views or distances. Reply with the description alone.",
          messages: [
            {
              role: "user",
              content: `${facts}\n\n${input.draft.trim() ? `Polish this draft, keeping its facts:\n${input.draft.trim()}` : "Write the description."}`,
            },
          ],
        }),
        signal: AbortSignal.timeout(30_000),
      }).catch(() => null);
      if (!response?.ok) throw new TRPCError({ code: "BAD_GATEWAY", message: "The writing helper did not answer — try again in a moment." });
      const data = (await response.json()) as { content?: { type: string; text?: string }[] };
      const text = (data.content ?? [])
        .filter((part) => part.type === "text")
        .map((part) => part.text ?? "")
        .join("")
        .trim();
      if (!text) throw new TRPCError({ code: "BAD_GATEWAY", message: "The writing helper gave no text — try again." });
      return { description: text };
    }),
});

/** What the client sees: no buying rates, only the rates offered, only properties offering one. */
export function clientCopy(card: ReturnType<typeof shape>) {
  return {
    name: card.name,
    currency: card.currency,
    intro: card.intro,
    clientName: card.clientName,
    /** Their last answer, to change and send again. */
    lastAnswer: card.answers[0] ? (({ isNew: _isNew, ...answer }) => answer)(card.answers[0]) : null,
    event: card.event,
    asked: card.asked,
    /** For the client's map (doc §4.11): the places distances are measured to — the venues. */
    venues: card.venues,
    properties: card.properties
      .map((property) => ({
        id: property.id,
        name: property.name,
        latitude: property.latitude,
        longitude: property.longitude,
        type: property.type,
        stars: property.stars,
        where: property.where,
        nearest: property.nearest,
        description: property.description,
        ...clientMedia(property),
        lines: property.lines
          .filter((line) => line.sellingCents !== null)
          .map((line) => ({
            id: line.id,
            categoryId: line.categoryId,
            name: line.name,
            sleeps: line.sleeps,
            sellingCents: line.sellingCents!,
            available: line.available,
            minNights: line.minNights,
          })),
      }))
      .filter((property) => property.lines.length > 0),
  };
}

/** "20 rooms of 1 kind", "35 rooms of 2 kinds, over 3 periods" — for the notification. */
function roomsInWords(items: { lineId: string; rooms: number }[]) {
  const kinds = new Set(items.map((item) => item.lineId)).size;
  const rooms = items.reduce((sum, item) => sum + item.rooms, 0);
  const words = `${rooms} ${rooms === 1 ? "room" : "rooms"} of ${kinds} ${kinds === 1 ? "kind" : "kinds"}`;
  return items.length > kinds ? `${words}, over ${items.length} periods` : words;
}
