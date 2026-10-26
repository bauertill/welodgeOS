import { randomBytes } from "crypto";
import type { Prisma, PrismaClient } from "generated/prisma";
import { TRPCError } from "@trpc/server";
import { z } from "zod";

import { env } from "~/env";
import { nightsBetween, parseDay, today } from "~/lib/dates";
import { clientMedia, photoSrc } from "~/lib/media";
import { measuredPlaces, nearestPlace } from "~/lib/scouting";
import { createTRPCRouter, protectedProcedure, publicProcedure } from "~/server/api/trpc";
import { clientContracting, clientContractingValues, moveStage, saveClientContracting } from "~/server/api/routers/sales";
import { legsForMode } from "~/server/api/routers/travel";
import { logAudit } from "~/server/audit";
import { ensureGetMediaTask, GET_MEDIA, hasMedia, withMedia } from "~/server/get-media";
import { ensureContractTask } from "~/server/contract-task";
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
  // The event a card is for — its request's, or, for a general card, its own (doc §4.11).
  event: {
    select: {
      id: true,
      name: true,
      startDate: true,
      endDate: true,
      placesOfInterest: {
        select: { id: true, name: true, category: true, notes: true, latitude: true, longitude: true, layer: { select: { measured: true, name: true, color: true } } },
      },
    },
  },
  salesRequest: {
    select: {
      id: true,
      ownerId: true,
      client: { select: { name: true } },
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

/** Where a card's history goes: its request's, or — a general card — its event's (doc §4.11). */
const cardHistory = (card: { id: string; salesRequestId: string | null; eventId: string | null }) =>
  card.salesRequestId
    ? { entity: "SalesRequest", entityId: card.salesRequestId }
    : { entity: card.eventId ? "Event" : "RateCard", entityId: card.eventId ?? card.id };

/** The card as it is read: each property with how far it is from the nearest venue (worked out, never stored). */
function shape(card: LoadedCard) {
  const places = card.event?.placesOfInterest ?? [];
  const venues = measuredPlaces(places);
  return {
    id: card.id,
    name: card.name,
    currency: card.currency,
    markupBasisPoints: card.markupBasisPoints,
    intro: card.intro,
    shareToken: card.shareToken,
    updatedAt: card.updatedAt,
    /** Empty for a general card — for any client (doc §4.11, 2026-10-26). */
    clientName: card.salesRequest?.client.name ?? null,
    /** The client's answers from its link, newest first (doc §4.11). */
    answers: card.responses.map((response) => ({
      id: response.id,
      at: response.createdAt,
      isNew: response.seenAt === null,
      name: response.name,
      email: response.email,
      company: response.company,
      /** The request it is on — for a general card, the one it started. */
      salesRequestId: response.salesRequestId,
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
    salesRequestId: card.salesRequest?.id ?? null,
    eventId: card.eventId,
    event: card.event ? { name: card.event.name, startDate: card.event.startDate, endDate: card.event.endDate } : null,
    asked: (card.salesRequest?.lines ?? []).map((line) => ({ rooms: line.rooms, roomType: line.roomType, checkIn: line.checkIn, checkOut: line.checkOut })),
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
        // None chosen on this card (it may be older than the media): the property's first six.
        photoIds: entry.photos.length ? entry.photos.map((photo) => photo.photoId) : entry.property.photos.slice(0, 6).map((photo) => photo.id),
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
  /**
   * A new card from the properties ticked on a sourcing task — or, with no
   * request, a general card for any client of the event, from its properties
   * board (doc §4.11, 2026-10-26): every room category, bought at its event
   * rate, sold at it plus the markup.
   */
  create: protectedProcedure
    .input(
      z
        .object({ salesRequestId: z.string().optional(), eventId: z.string().optional(), propertyIds: z.array(z.string()).min(1, "Tick at least one property.").max(30) })
        .refine((input) => input.salesRequestId ?? input.eventId, "A rate card is for a request or an event."),
    )
    .mutation(async ({ ctx, input }) => {
      return ctx.db.$transaction(async (tx) => {
        const request = input.salesRequestId
          ? await tx.salesRequest.findUniqueOrThrow({
              where: { id: input.salesRequestId },
              select: { eventId: true, budgetCurrency: true, client: { select: { name: true } }, event: { select: { name: true } }, _count: { select: { rateCards: true } } },
            })
          : null;
        const eventId = request?.eventId ?? input.eventId ?? null;
        const event = eventId ? await tx.event.findUnique({ where: { id: eventId }, select: { name: true, country: true, _count: { select: { rateCards: { where: { salesRequestId: null } } } } } }) : null;
        const properties = await tx.property.findMany({
          where: { id: { in: input.propertyIds } },
          select: {
            id: true,
            ...withMedia,
            categories: { orderBy: { sortOrder: "asc" }, select: { id: true, name: true, capacity: true, unitCount: true } },
            photos: { orderBy: [{ position: "asc" }, { createdAt: "asc" }], take: CARD_PHOTOS, select: { id: true } },
          },
        });
        const rates = eventId ? (await eventRates(tx, { propertyIds: input.propertyIds, eventId })).get(eventId) : undefined;
        const currency = request?.budgetCurrency ?? [...(rates?.values() ?? [])][0]?.currency ?? "USD";
        const name = request
          ? `Rate card${request._count.rateCards ? ` ${request._count.rateCards + 1}` : ""} — ${request.client.name}${request.event ? ` — ${request.event.name}` : ""}`
          : `Rate card${event?._count.rateCards ? ` ${event._count.rateCards + 1}` : ""} — ${event?.name ?? "event"} — for any client`;
        const card = await tx.rateCard.create({
          data: {
            name,
            salesRequestId: input.salesRequestId ?? null,
            eventId,
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
        await logAudit(tx, {
          actorId: ctx.session.user.id,
          entity: input.salesRequestId ? "SalesRequest" : "Event",
          entityId: input.salesRequestId ?? eventId ?? card.id,
          summary: `Rate card made: ${card.name}`,
        });
        // Any property with no photos or video yet: a task to get them, as the card cannot be shared without (doc §4.11).
        for (const property of properties.filter((one) => !hasMedia(one))) {
          await ensureGetMediaTask(tx, { propertyId: property.id, salesRequestId: input.salesRequestId ?? null, eventId, actorId: ctx.session.user.id });
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

  /** An event's general rate cards — for any client, made from its properties board (doc §4.11). */
  forEvent: protectedProcedure.input(z.object({ eventId: z.string() })).query(({ ctx, input }) =>
    ctx.db.rateCard.findMany({
      where: { eventId: input.eventId, salesRequestId: null },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        name: true,
        createdAt: true,
        shareToken: true,
        _count: { select: { properties: true, responses: true } },
        responses: { where: { seenAt: null }, select: { id: true } },
      },
    }),
  ),

  /** How many requests have an answer from the client nobody in the team has opened yet — the red count on Sales (doc §4.11). */
  newAnswers: protectedProcedure.query(async ({ ctx }) => {
    const unseen = await ctx.db.rateCardResponse.findMany({ where: { seenAt: null }, select: { salesRequestId: true, rateCardId: true } });
    return { requests: new Set(unseen.map((response) => response.salesRequestId ?? response.rateCardId)).size };
  }),

  /**
   * Every answer the client sent on this request's rate cards, newest first —
   * what the request's page puts at its top (doc §4.11).
   */
  answersForRequest: protectedProcedure.input(z.object({ salesRequestId: z.string() })).query(async ({ ctx, input }) => {
    const responses = await ctx.db.rateCardResponse.findMany({
      // On the request: its own cards' answers, and a general card's answer that started it.
      where: { salesRequestId: input.salesRequestId },
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
      company: response.company,
      /** The request it is on — for a general card, the one it started. */
      salesRequestId: response.salesRequestId,
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
    await ctx.db.rateCardResponse.updateMany({ where: { salesRequestId: input.salesRequestId, seenAt: null }, data: { seenAt: new Date() } });
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
        const card = await tx.rateCard.findUniqueOrThrow({ where: { id: input.id }, select: { id: true, salesRequestId: true, eventId: true, properties: { select: { id: true, lines: { select: { id: true } } } } } });
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
        await logAudit(tx, { actorId: ctx.session.user.id, ...cardHistory(card), summary: `Rate card saved: ${input.name}` });
      });
      return { ok: true };
    }),

  remove: protectedProcedure.input(z.object({ id: z.string() })).mutation(async ({ ctx, input }) => {
    const card = await ctx.db.rateCard.delete({ where: { id: input.id } });
    await logAudit(ctx.db, { actorId: ctx.session.user.id, ...cardHistory(card), summary: `Rate card deleted: ${card.name}` });
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
        select: { id: true, shareToken: true, salesRequestId: true, eventId: true, name: true, salesRequest: { select: { stage: true } } },
      });
      await logAudit(tx, { actorId: ctx.session.user.id, ...cardHistory(card), summary: `Rate card link made: ${card.name}` });
      const early = card.salesRequest?.stage === "INITIAL_INTEREST" || card.salesRequest?.stage === "SPECIFY";
      if (early && card.salesRequestId) await moveStage(tx, ctx.session.user.id, card.salesRequestId, "PROPOSAL_SENT");
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
          eventId: true,
          properties: { where: { id: input.rateCardPropertyId }, select: { property: { select: { latitude: true, longitude: true } } } },
        },
      });
      const from = card?.properties[0]?.property;
      const place = await ctx.db.placeOfInterest.findFirst({
        where: { id: input.placeId, eventId: card?.eventId ?? "none" },
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
   * The client's contracting details, from their rate card (doc §4.11,
   * 2026-10-14): asked for right after they send their request, and until
   * they are in — what the agreement is drawn up with.
   */
  contracting: publicProcedure
    .input(z.object({ token: z.string().min(20).max(100), responseId: z.string().nullable().default(null) }))
    .query(async ({ ctx, input }) => {
      const requestId = await answeringRequest(ctx.db, input.token, input.responseId);
      // A general card before its answer: nobody to ask yet.
      return requestId ? { general: false, ...(await clientContracting(ctx.db, requestId)) } : { general: true, submittedAt: null, values: null };
    }),

  submitContracting: publicProcedure
    .input(z.object({ token: z.string().min(20).max(100), responseId: z.string().nullable().default(null), values: clientContractingValues }))
    .mutation(async ({ ctx, input }) => {
      const requestId = await answeringRequest(ctx.db, input.token, input.responseId);
      if (!requestId) throw new TRPCError({ code: "BAD_REQUEST", message: "Send your request first — your company details go with it." });
      await ctx.db.$transaction((tx) => saveClientContracting(tx, requestId, input.values, "from the rate card"));
      await deliverImmediate(ctx.db);
      return { ok: true };
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
        /** Their company — asked on a general card, where we do not know them yet (doc §4.11). */
        company: z.string().trim().max(200).default(""),
        /** On a general card, their earlier answer from this browser: a new one goes onto the same request. */
        previousResponseId: z.string().nullable().default(null),
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
            currency: true,
            createdById: true,
            eventId: true,
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
        // A general card's answer starts a sales request for whoever answered (doc §4.11, 2026-10-26).
        const earlier =
          !card.salesRequest && input.previousResponseId
            ? await tx.rateCardResponse.findFirst({
                where: { id: input.previousResponseId, rateCardId: card.id, salesRequestId: { not: null } },
                select: { salesRequest: { select: { id: true, ownerId: true, client: { select: { name: true } } } } },
              })
            : null;
        const request =
          card.salesRequest ??
          earlier?.salesRequest ??
          (await requestFromAnswer(tx, card, input, items.map((item) => ({ ...item, roomName: lines.get(item.lineId)!.name })), day));
        const response = await tx.rateCardResponse.create({
          data: {
            rateCardId: card.id,
            salesRequestId: request.id,
            company: input.company || null,
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
          entityId: request.id,
          summary: `Rate card answered by the client: ${card.name}`,
          changes: said || input.note.trim() || null,
        });
        await notify(tx, {
          to: [request.ownerId, card.createdById],
          actorId: null,
          kind: "RATE_CARD_ANSWERED",
          title: `${request.client.name} answered the rate card${said ? `: ${said}` : ""}${card.salesRequest ? "" : " — a new sales request"}`,
          body: input.note.trim() || null,
          link: `/sales/${request.id}`,
        });
        // Rooms chosen: the account manager's contract task, to put the offer together (doc §4.11).
        if (items.length) {
          await ensureContractTask(tx, {
            salesRequestId: request.id,
            cardMadeById: card.createdById,
            currency: card.currency,
            items: items.map((item) => {
              const line = lines.get(item.lineId)!;
              return { propertyName: line.propertyName, roomName: line.name, rooms: item.rooms, checkIn: day(item.checkIn), checkOut: day(item.checkOut), sellingCents: line.sellingCents };
            }),
          });
        }
        return { id: response.id, salesRequestId: request.id };
      });
      await deliverImmediate(ctx.db);
      return result;
    }),

  /**
   * A short description of a property for the card, written — or a draft
   * polished — by Claude from what we know of it. Needs ANTHROPIC_API_KEY.
   * Not offered on screen for now (owner, 2026-10-13); kept for when the key is set.
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
/**
 * Someone answered a general card (doc §4.11, 2026-10-26): their company is
 * found among our clients — by name or short name — or added; a sales request
 * for the event starts, for whoever made the card, at *Proposal sent* — they
 * had our rate card — with the rooms they chose as its lines, and whoever
 * answered as its contact.
 */
async function requestFromAnswer(
  tx: Prisma.TransactionClient,
  card: { name: string; eventId: string | null; createdById: string | null },
  input: { company: string; name: string; email: string },
  items: { rooms: number; checkIn: string; checkOut: string; roomName: string }[],
  day: (text: string) => Date | null,
) {
  const company = input.company.trim();
  if (!company) throw new TRPCError({ code: "BAD_REQUEST", message: "Please give your company's name." });
  const client =
    (await tx.client.findFirst({
      where: { OR: [{ name: { equals: company, mode: "insensitive" } }, { shortName: { equals: company, mode: "insensitive" } }] },
      select: { id: true, name: true },
    })) ?? (await tx.client.create({ data: { name: company }, select: { id: true, name: true } }));
  const contact = input.name
    ? ((await tx.clientContact.findFirst({
        where: { clientId: client.id, OR: [...(input.email ? [{ email: { equals: input.email, mode: "insensitive" as const } }] : []), { name: { equals: input.name, mode: "insensitive" } }] },
        select: { id: true },
      })) ?? (await tx.clientContact.create({ data: { clientId: client.id, name: input.name, email: input.email || null }, select: { id: true } })))
    : null;
  const request = await tx.salesRequest.create({
    data: {
      clientId: client.id,
      contactId: contact?.id ?? null,
      eventId: card.eventId,
      ownerId: card.createdById,
      stage: "PROPOSAL_SENT",
      proposalSentOn: today(),
      description: `Answered the rate card "${card.name}".`,
      detailedAt: items.length ? new Date() : null,
      lines: {
        create: items.map((item, position) => ({ rooms: item.rooms, roomType: item.roomName, checkIn: day(item.checkIn), checkOut: day(item.checkOut), position })),
      },
    },
    select: { id: true, ownerId: true, client: { select: { name: true } } },
  });
  await logAudit(tx, { actorId: null, entity: "SalesRequest", entityId: request.id, summary: `Registered from the rate card "${card.name}", answered by ${input.name || client.name}` });
  await logAudit(tx, { actorId: null, entity: "Client", entityId: client.id, summary: "Sales request added, from a rate card answer" });
  return request;
}

/**
 * The request a client on a card's link is answering for: the card's own, or —
 * on a general card — the one their own answer started, known by its id, which
 * only they were given (doc §4.11). Null on a general card before they answer.
 */
async function answeringRequest(db: PrismaClient, token: string, responseId: string | null) {
  const card = await db.rateCard.findUnique({ where: { shareToken: token }, select: { id: true, salesRequestId: true } });
  if (!card) throw new TRPCError({ code: "NOT_FOUND", message: "This rate card is not shared any more." });
  if (card.salesRequestId) return card.salesRequestId;
  if (!responseId) return null;
  const answer = await db.rateCardResponse.findFirst({ where: { id: responseId, rateCardId: card.id }, select: { salesRequestId: true } });
  return answer?.salesRequestId ?? null;
}

export function clientCopy(card: ReturnType<typeof shape>) {
  return {
    name: card.name,
    currency: card.currency,
    intro: card.intro,
    clientName: card.clientName,
    /** Their last answer, to change and send again. */
    /** A general card's link is for anyone: no one is shown another's answer (doc §4.11). */
    general: card.salesRequestId === null,
    lastAnswer: card.salesRequestId && card.answers[0] ? (({ isNew: _isNew, company: _company, ...answer }) => answer)(card.answers[0]) : null,
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
