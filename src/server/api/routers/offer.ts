import { randomBytes } from "crypto";

import { TRPCError } from "@trpc/server";
import { z } from "zod";

import type { Prisma, PrismaClient } from "generated/prisma";

import { fillAgreement, type AgreementData } from "~/lib/agreement";
import { DEFAULT_AGREEMENT_TEMPLATE } from "~/lib/agreement-template";
import { DEFAULT_HOTEL_AGREEMENT_TEMPLATE } from "~/lib/hotel-agreement-template";
import { addDays, dayKey, nightsBetween, parseDay, today } from "~/lib/dates";
import { formatDate, formatMoney } from "~/lib/format";
import { createTRPCRouter, protectedProcedure, publicProcedure } from "~/server/api/trpc";
import { cutSummary } from "~/lib/cancellation";
import { cancellationInput, paymentInput } from "~/server/api/routers/quotation";
import { applyInventoryChange } from "~/server/api/routers/inventory";
import { addRoomsTx, changeRoomsTx, moveStage, rectangles } from "~/server/api/routers/sales";
import { canTrust } from "~/lib/offers";
import { ensureAcquireTask } from "~/server/acquire";
import { moveContractTask } from "~/server/contract-task";
import { logAudit } from "~/server/audit";
import { deliverImmediate, notify } from "~/server/notify";

/**
 * Offers to a client (doc §4.11, 2026-10-14). After the client answers a rate
 * card we make them an offer — the rooms they chose, at our rates, with
 * payment and cancellation terms — that holds until a date. Making it blocks
 * the rooms in the inventory until then, so nobody else is offered them; the
 * agreement is filled from it. An offer past its date is flagged, never
 * released on its own: a person extends it or withdraws it.
 */

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Give the date");
const HOLDING_DAYS = 7;

const lineInput = z.object({
  categoryId: z.string().min(1, "Choose the room type for each line"),
  rooms: z.number().int().min(1, "Each line needs at least one room").max(500),
  checkIn: day,
  checkOut: day,
  rateCents: z.number().int().min(0),
});

const offerInput = z.object({
  salesRequestId: z.string(),
  responseId: z.string().nullable(),
  currency: z.string().length(3),
  validUntil: day,
  inclusions: z.string().max(3000),
  conditions: z.string().max(3000),
  lines: z.array(lineInput).min(1, "An offer needs at least one line of rooms").max(50),
  payments: z.array(paymentInput).max(20),
  cancellations: z.array(cancellationInput).max(20),
});

const include = {
  lines: {
    orderBy: { position: "asc" as const },
    include: { category: { select: { id: true, name: true, property: { select: { id: true, name: true, address: true, city: true } } } } },
  },
  payments: { orderBy: { position: "asc" as const } },
  cancellations: { orderBy: { position: "asc" as const } },
  createdBy: { select: { name: true } },
  closedBy: { select: { name: true } },
  contract: { select: { id: true, name: true, signedOn: true, documentUrl: true, eventId: true } },
};

const blank = (value: string) => (value.trim() ? value.trim() : null);

/** An offer's total: every line's rooms × nights × rate. */
export const offerTotal = (lines: { rooms: number; checkIn: Date; checkOut: Date; rateCents: number }[]) =>
  lines.reduce((sum, line) => sum + line.rooms * nightsBetween(line.checkIn, line.checkOut) * line.rateCents, 0);

/** Our agreements, each with the wording it starts as (doc §4.11): for clients, and for hotels at US events. */
export const AGREEMENT_TEMPLATES = { framework: DEFAULT_AGREEMENT_TEMPLATE, "hotel-us": DEFAULT_HOTEL_AGREEMENT_TEMPLATE } as const;
export type AgreementKind = keyof typeof AGREEMENT_TEMPLATES;
const agreementKind = z.enum(["framework", "hotel-us"]);

/** An agreement's wording: as the team last changed it, else the original. */
export async function frameworkText(db: PrismaClient, kind: AgreementKind = "framework") {
  const saved = await db.agreementTemplate.findUnique({ where: { id: kind }, include: { updatedBy: { select: { name: true } } } });
  return { text: saved?.text ?? AGREEMENT_TEMPLATES[kind], changed: saved ? { at: saved.updatedAt, by: saved.updatedBy?.name ?? null } : null };
}

/** The offer's agreement, filled from the framework, the client's contracting details, the offer and the event. */
async function filledAgreement(db: PrismaClient, offerId: string) {
  const offer = await db.offer.findUniqueOrThrow({
    where: { id: offerId },
    include: {
      ...include,
      salesRequest: {
        select: {
          id: true,
          tradeName: true,
          companyAddress: true,
          signatory1Name: true,
          signatory1Designation: true,
          signatory2Name: true,
          signatory2Designation: true,
          client: { select: { name: true } },
          event: { select: { name: true, startDate: true, endDate: true, country: true } },
          amendsContract: { select: { name: true } },
        },
      },
    },
  });
  const request = offer.salesRequest;
  if (!request.event) throw new TRPCError({ code: "BAD_REQUEST", message: "The request has no event." });
  const lines = (s: string | null | undefined) => (s ?? "").split("\n").map((line) => line.trim()).filter(Boolean);
  const data: AgreementData = {
    client: {
      name: request.tradeName,
      address: request.companyAddress,
      signatories: [
        { name: request.signatory1Name ?? "", designation: request.signatory1Designation },
        { name: request.signatory2Name ?? "", designation: request.signatory2Designation },
      ],
    },
    currency: offer.currency,
    event: request.event,
    lines: offer.lines.map((line) => ({
      property: line.category.property.name,
      propertyAddress: line.category.property.address ?? line.category.property.city,
      room: line.category.name,
      rooms: line.rooms,
      checkIn: line.checkIn,
      checkOut: line.checkOut,
      rateCents: line.rateCents,
    })),
    payments: offer.payments,
    cancellations: offer.cancellations,
    inclusions: lines(offer.inclusions),
    conditions: lines(offer.conditions),
    validUntil: offer.validUntil,
  };
  const framework = await frameworkText(db);
  return { offer, request, filled: fillAgreement(framework.text, data) };
}

/**
 * The client has signed — or an admin vouched for them (doc §4.11): their
 * contract is made from the offer, its rooms are sold under it, the request is
 * contracted, the rooms go in progress with each hotel and each hotel gets an
 * acquire task; the account manager is told.
 */
/**
 * Where an offer's rooms of one room type stand on its request: blocked (the
 * agreement has gone), requested (made, agreement not sent yet), or neither.
 */
async function heldAs(tx: Prisma.TransactionClient, salesRequestId: string, categoryId: string) {
  const blocked = await tx.roomNight.count({ where: { salesRequestId, salesState: "BLOCKED", slot: { categoryId } } });
  if (blocked) return "BLOCKED" as const;
  const requested = await tx.roomNightRequest.count({ where: { salesRequestId, roomNight: { slot: { categoryId } } } });
  return requested ? ("REQUESTED" as const) : null;
}

/** The offer's rooms let go, however they are held: blocks released, requests withdrawn. */
async function letGo(tx: Prisma.TransactionClient, actorId: string, salesRequestId: string, categoryIds: Iterable<string>) {
  for (const categoryId of new Set(categoryIds)) {
    const held = await heldAs(tx, salesRequestId, categoryId);
    if (held === "BLOCKED") await changeRoomsTx(tx, actorId, { id: salesRequestId, categoryId, state: "BLOCKED", action: "RELEASE_HOLD" });
    else if (held === "REQUESTED") await changeRoomsTx(tx, actorId, { id: salesRequestId, categoryId, state: "REQUESTED", action: "WITHDRAW_REQUEST" });
  }
}

/**
 * The offer's rooms taken: requested while the agreement has not gone (the
 * owner, 2026-11-20: "once we mark the agreement as sent, we can proceed with
 * blocking"), blocked until the offer runs out once it has.
 */
async function takeRooms(
  tx: Prisma.TransactionClient,
  actorId: string,
  salesRequestId: string,
  lines: { categoryId: string; rooms: number; checkIn: string; checkOut: string; rateCents: number }[],
  currency: string,
  validUntil: string,
  firm: boolean,
) {
  for (const line of lines) {
    await addRoomsTx(tx, actorId, {
      id: salesRequestId,
      categoryId: line.categoryId,
      rooms: line.rooms,
      checkIn: line.checkIn,
      checkOut: line.checkOut,
      action: firm ? "BLOCK" : "REQUEST",
      blockExpiry: firm ? validUntil : undefined,
      sellPriceCents: line.rateCents,
      sellCurrency: currency,
    });
  }
}

async function closeOffer(
  tx: Prisma.TransactionClient,
  actor: { id: string; name: string | null },
  offerId: string,
  how: { signed: true; signedOn: Date; documentUrl: string | null } | { signed: false },
) {
  const offer = await tx.offer.findUniqueOrThrow({
    where: { id: offerId },
    include: { ...include, salesRequest: { select: { id: true, clientId: true, eventId: true, ownerId: true, client: { select: { name: true } }, event: { select: { name: true } }, amendsContract: { select: { name: true } } } } },
  });
  if (offer.status !== "OPEN") throw new TRPCError({ code: "BAD_REQUEST", message: "This offer is not open any more." });
  const request = offer.salesRequest;
  if (!request.eventId || !request.event) throw new TRPCError({ code: "BAD_REQUEST", message: "The request has no event." });
  const total = offerTotal(offer.lines);
  const signedOn = how.signed ? how.signedOn : null;
  const contract = await tx.contract.create({
    data: {
      party: "CLIENT",
      // An addendum's signed copy is its own contract, named for the one it adds to (doc §4.11).
      name: request.amendsContract ? `Addendum to ${request.amendsContract.name}` : `${request.client.name} — ${request.event.name} agreement`,
      eventId: request.eventId,
      clientId: request.clientId,
      salesRequestId: request.id,
      documentUrl: how.signed ? how.documentUrl : null,
      signedOn,
      totalCents: total,
      currency: offer.currency,
      ownerId: request.ownerId ?? actor.id,
      notes: [
        how.signed ? "Made from the offer when the client signed." : `Not signed yet — trust guarantee by ${actor.name ?? "an admin"} on ${formatDate(today())}.`,
        ...offer.cancellations.filter((cut) => !cut.cutoffOn && cut.remarks).map((cut) => `Cancellation: ${cut.remarks}`),
      ].join("\n\n"),
      noCancellationTerms: offer.cancellations.length === 0,
      payments: {
        create: offer.payments.map((payment, index) => ({
          description: payment.onSignature ? "On signature" : `Payment ${index + 1}`,
          // On signature falls due when signed — or today, when vouched for.
          dueOn: payment.onSignature ? (signedOn ?? today()) : payment.dueOn!,
          percentBasisPoints: payment.percentBasisPoints,
        })),
      },
      cancellations: {
        // A term in words with no date has no cut-off to watch: it goes in the contract's notes (2026-11-18).
        create: offer.cancellations
          .filter((cut) => cut.cutoffOn)
          .map((cut) => ({
            kind: cut.kind,
            cutoffOn: cut.cutoffOn!,
            percentBasisPoints: cut.percentBasisPoints,
            feeBasisPoints: cut.feeBasisPoints,
            appliesTo: cut.rooms !== null ? `${cut.rooms} ${cut.rooms === 1 ? "room" : "rooms"}` : null,
            roomType: cut.roomType,
            remarks: cut.remarks,
          })),
      },
    },
  });
  // The offer's rooms are sold under it — blocked ones, or still requested ones when it is
  // signed or vouched for before the agreement was marked sent.
  for (const categoryId of new Set(offer.lines.map((line) => line.categoryId))) {
    const held = await heldAs(tx, request.id, categoryId);
    if (!held) {
      const line = offer.lines.find((one) => one.categoryId === categoryId)!;
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: `Nothing was changed. The ${line.category.name} rooms at ${line.category.property.name} are not held for this client any more — edit the offer to take them again first.`,
      });
    }
    await changeRoomsTx(tx, actor.id, { id: request.id, categoryId, state: held, action: "SELL", salesContractId: contract.id });
  }
  await tx.offer.update({ where: { id: offer.id }, data: { status: how.signed ? "SIGNED" : "TRUSTED", contractId: contract.id, closedById: actor.id, closedAt: new Date() } });
  await tx.salesRequest.update({ where: { id: request.id }, data: { blockedUntil: null } });
  await logAudit(tx, {
    actorId: actor.id,
    entity: "SalesRequest",
    entityId: request.id,
    summary: how.signed
      ? `Agreement signed by the client on ${formatDate(how.signedOn)} — rooms sold`
      : `Trust guarantee: ${actor.name ?? "an admin"} vouched for the client — rooms sold before the agreement is back`,
  });
  await logAudit(tx, { actorId: actor.id, entity: "Contract", entityId: contract.id, summary: "Contract made from the client's offer" });
  await moveStage(tx, actor.id, request.id, "CONTRACTED");
  await moveContractTask(tx, actor.id, request.id, "DONE", how.signed ? "the client signed" : "trust guarantee given");

  // Each hotel: the sold rooms go in progress with it, and someone is to secure them —
  // unless we hold them already (the owner, 2026-11-12: "we don't need to acquire that which we have").
  const acquireFor: string[] = [];
  const alreadyOurs: string[] = [];
  const byProperty = new Map<string, typeof offer.lines>();
  for (const line of offer.lines) byProperty.set(line.category.property.id, [...(byProperty.get(line.category.property.id) ?? []), line]);
  for (const [propertyId, lines] of byProperty) {
    const open = await tx.roomNight.findMany({
      where: { salesRequestId: request.id, salesState: "SOLD", acquisitionState: { in: ["NONE", "RELEASED"] }, slot: { category: { propertyId } } },
      select: { slotId: true, date: true },
    });
    for (const rect of rectangles(open)) {
      await applyInventoryChange(tx, actor.id, {
        eventId: request.eventId,
        slotIds: rect.slotIds,
        checkIn: rect.checkIn,
        checkOut: rect.checkOut,
        action: "START_NEGOTIATION",
        reason: "The client signed — securing the rooms from the hotel",
      });
    }
    const stillToBuy = await tx.roomNight.count({
      where: { salesRequestId: request.id, salesState: "SOLD", acquisitionState: { not: "BOUGHT" }, slot: { category: { propertyId } } },
    });
    const propertyName = lines[0]!.category.property.name;
    if (stillToBuy === 0) {
      alreadyOurs.push(propertyName);
      await logAudit(tx, {
        actorId: actor.id,
        entity: "SalesRequest",
        entityId: request.id,
        summary: `No acquire task for ${propertyName} — every room sold there was already bought from the hotel`,
      });
      continue;
    }
    acquireFor.push(propertyName);
    await ensureAcquireTask(tx, {
      salesRequestId: request.id,
      propertyId,
      eventId: request.eventId,
      actorId: actor.id,
      currency: offer.currency,
      lines: lines.map((line) => ({ room: line.category.name, rooms: line.rooms, checkIn: line.checkIn, checkOut: line.checkOut, rateCents: line.rateCents })),
    });
  }
  await notify(tx, {
    to: [request.ownerId, offer.createdById],
    actorId: actor.id,
    kind: "OFFER_SIGNED",
    title: how.signed ? `${request.client.name} signed the agreement — ${request.event.name}` : `${request.client.name}: trust guarantee given — ${request.event.name}`,
    body: [
      `${offer.lines.reduce((sum, line) => sum + line.rooms, 0)} rooms sold, ${formatMoney(total, offer.currency)}.`,
      acquireFor.length ? `Acquire task${acquireFor.length === 1 ? "" : "s"} out for ${acquireFor.join(", ")}.` : "",
      alreadyOurs.length ? `Already bought, nothing to acquire: ${alreadyOurs.join(", ")}.` : "",
    ]
      .filter(Boolean)
      .join(" "),
    link: `/sales/${request.id}`,
  });
  return contract;
}

export const offerRouter = createTRPCRouter({
  /**
   * What the offer form starts from: the client's latest rate card answer as
   * lines, the room types it can be made in, and the terms of the last offer
   * on this event — terms rarely change between clients of one event.
   */
  formContext: protectedProcedure.input(z.object({ salesRequestId: z.string(), responseId: z.string().nullable() })).query(async ({ ctx, input }) => {
    const request = await ctx.db.salesRequest.findUniqueOrThrow({
      where: { id: input.salesRequestId },
      select: {
        id: true,
        eventId: true,
        tradeName: true,
        signatory1Name: true,
        client: { select: { name: true } },
        // The answers on this request — on its own cards, or the general card's answer that started it (doc §4.11).
        rateCardAnswers: {
          orderBy: { createdAt: "desc" },
          select: {
            id: true,
            createdAt: true,
            rateCard: { select: { currency: true, properties: { select: { propertyId: true } } } },
            items: { select: { rooms: true, checkIn: true, checkOut: true, sellingCents: true, line: { select: { categoryId: true } } } },
          },
        },
        rateCards: { orderBy: { createdAt: "desc" }, select: { currency: true, properties: { select: { propertyId: true } } } },
      },
    });
    if (!request.eventId) throw new TRPCError({ code: "BAD_REQUEST", message: "Choose the event under Details first — an offer's rooms belong to an event." });
    const responses = request.rateCardAnswers.map((response) => ({ ...response, currency: response.rateCard.currency }));
    const answer =
      (input.responseId ? responses.find((response) => response.id === input.responseId) : null) ??
      responses.filter((response) => response.items.length).sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0] ??
      null;
    const onCards = new Set([
      ...request.rateCards.flatMap((card) => card.properties.map((property) => property.propertyId)),
      ...request.rateCardAnswers.flatMap((answer) => answer.rateCard.properties.map((property) => property.propertyId)),
    ]);
    const entries = await ctx.db.scoutingEntry.findMany({
      where: { eventId: request.eventId },
      select: { property: { select: { id: true, name: true, categories: { orderBy: { sortOrder: "asc" }, select: { id: true, name: true } } } } },
    });
    // The properties on the client's rate cards first, then the event's others.
    const categories = entries
      .filter((entry) => entry.property.categories.length)
      .sort((a, b) => Number(onCards.has(b.property.id)) - Number(onCards.has(a.property.id)) || a.property.name.localeCompare(b.property.name))
      .flatMap((entry) => entry.property.categories.map((category) => ({ id: category.id, name: category.name, property: entry.property.name })));
    const last = await ctx.db.offer.findFirst({
      where: { salesRequest: { eventId: request.eventId } },
      orderBy: { createdAt: "desc" },
      include: { payments: { orderBy: { position: "asc" } }, cancellations: { orderBy: { position: "asc" } } },
    });
    const event = await ctx.db.event.findUniqueOrThrow({ where: { id: request.eventId }, select: { name: true, startDate: true, endDate: true } });
    return {
      clientName: request.client.name,
      /** What the agreement is drawn up with — the company and who signs (doc §4.11). */
      contracting: { tradeName: request.tradeName, signatory: request.signatory1Name },
      event,
      responseId: answer?.id ?? null,
      currency: answer?.currency ?? request.rateCards[0]?.currency ?? "USD",
      validUntil: dayKey(addDays(today(), HOLDING_DAYS)),
      lines: (answer?.items ?? []).map((item) => ({
        categoryId: item.line?.categoryId ?? "",
        rooms: item.rooms,
        checkIn: item.checkIn ? dayKey(item.checkIn) : dayKey(event.startDate),
        checkOut: item.checkOut ? dayKey(item.checkOut) : dayKey(event.endDate),
        rateCents: item.sellingCents ?? 0,
      })),
      categories,
      termsFrom: last ? { inclusions: last.inclusions ?? "", conditions: last.conditions ?? "", payments: last.payments, cancellations: last.cancellations } : null,
    };
  }),

  forRequest: protectedProcedure.input(z.object({ salesRequestId: z.string() })).query(async ({ ctx, input }) => {
    const offers = await ctx.db.offer.findMany({ where: { salesRequestId: input.salesRequestId }, orderBy: { createdAt: "desc" }, include });
    const now = today();
    return offers.map((offer) => ({ ...offer, totalCents: offerTotal(offer.lines), runOut: offer.status === "OPEN" && offer.validUntil < now }));
  }),

  /**
   * Make an offer: its rooms are requested for the client — blocked only once
   * the agreement is marked sent (the owner, 2026-11-20) — through the same
   * rules, ledger and undo as the stock sheet, all or nothing; the request
   * moves to Negotiation.
   */
  create: protectedProcedure.input(offerInput).mutation(({ ctx, input }) =>
    ctx.db.$transaction(
      async (tx) => {
        const actorId = ctx.session.user.id;
        const request = await tx.salesRequest.findUniqueOrThrow({ where: { id: input.salesRequestId }, select: { stage: true, eventId: true } });
        if (!request.eventId) throw new TRPCError({ code: "BAD_REQUEST", message: "Choose the event under Details first — an offer's rooms belong to an event." });
        const validUntil = parseDay(input.validUntil);
        if (validUntil < today()) throw new TRPCError({ code: "BAD_REQUEST", message: "The offer has to hold until today or later." });
        for (const line of input.lines) {
          if (parseDay(line.checkOut) <= parseDay(line.checkIn)) throw new TRPCError({ code: "BAD_REQUEST", message: "Each line's departure must be after its arrival." });
        }
        const offer = await tx.offer.create({
          data: {
            salesRequestId: input.salesRequestId,
            responseId: input.responseId,
            currency: input.currency,
            validUntil,
            inclusions: blank(input.inclusions),
            conditions: blank(input.conditions),
            createdById: actorId,
            lines: {
              create: input.lines.map((line, position) => ({
                categoryId: line.categoryId,
                rooms: line.rooms,
                checkIn: parseDay(line.checkIn),
                checkOut: parseDay(line.checkOut),
                rateCents: line.rateCents,
                position,
              })),
            },
            payments: {
              create: input.payments.map((payment, position) => ({
                onSignature: payment.onSignature,
                dueOn: payment.onSignature || !payment.dueOn ? null : parseDay(payment.dueOn),
                percentBasisPoints: payment.percentBasisPoints,
                position,
              })),
            },
            cancellations: {
              create: input.cancellations.map((cut, position) => ({
                kind: cut.kind,
                cutoffOn: cut.cutoffOn ? parseDay(cut.cutoffOn) : null,
                percentBasisPoints: cut.percentBasisPoints,
                feeBasisPoints: cut.feeBasisPoints,
                rooms: cut.rooms,
                roomType: cut.rooms !== null ? cut.roomType.trim() || null : null,
                remarks: cut.remarks.trim() || null,
                position,
              })),
            },
          },
        });
        // The rooms, requested for the client — or nothing is made. They are blocked when the agreement is marked sent.
        await takeRooms(tx, actorId, input.salesRequestId, input.lines, input.currency, input.validUntil, false);
        const total = offerTotal(input.lines.map((line) => ({ ...line, checkIn: parseDay(line.checkIn), checkOut: parseDay(line.checkOut) })));
        await tx.salesRequest.update({
          where: { id: input.salesRequestId },
          data: { valueCents: total, valueCurrency: input.currency },
        });
        await logAudit(tx, {
          actorId,
          entity: "SalesRequest",
          entityId: input.salesRequestId,
          summary: `Offer made: ${input.lines.reduce((sum, line) => sum + line.rooms, 0)} rooms requested, ${formatMoney(total, input.currency)}, holding until ${formatDate(validUntil)} — blocked once the agreement is sent`,
        });
        if (["INITIAL_INTEREST", "SPECIFY", "PROPOSAL_SENT"].includes(request.stage)) await moveStage(tx, actorId, input.salesRequestId, "NEGOTIATION");
        await moveContractTask(tx, actorId, input.salesRequestId, "IN_PROGRESS", "the offer is made");
        return { id: offer.id };
      },
      { timeout: 60_000 },
    ),
  ),

  /**
   * Change an open offer (the owner, 2026-11-18: "we should be able to edit an
   * offer"): its rooms, dates, rates, how long it holds and its terms. When the
   * rooms change, the request's blocked rooms are released and the new ones
   * blocked in the same step — all or nothing, through the stock sheet's rules
   * and ledger, so a room someone else took meanwhile refuses the change and
   * the old rooms stay held. Only an open offer: a signed one is the contract.
   */
  update: protectedProcedure.input(offerInput.extend({ id: z.string() })).mutation(({ ctx, input }) =>
    ctx.db.$transaction(
      async (tx) => {
        const actorId = ctx.session.user.id;
        const offer = await tx.offer.findUniqueOrThrow({ where: { id: input.id }, include: { lines: { orderBy: { position: "asc" } } } });
        if (offer.salesRequestId !== input.salesRequestId) throw new TRPCError({ code: "NOT_FOUND", message: "That offer is not this request's." });
        if (offer.status !== "OPEN") throw new TRPCError({ code: "BAD_REQUEST", message: "Only an open offer can be changed — a signed one is the contract now." });
        const validUntil = parseDay(input.validUntil);
        if (validUntil < today()) throw new TRPCError({ code: "BAD_REQUEST", message: "The offer has to hold until today or later." });
        for (const line of input.lines) {
          if (parseDay(line.checkOut) <= parseDay(line.checkIn)) throw new TRPCError({ code: "BAD_REQUEST", message: "Each line's departure must be after its arrival." });
        }
        const key = (line: { categoryId: string; rooms: number; checkIn: string; checkOut: string; rateCents: number }) =>
          [line.categoryId, line.rooms, line.checkIn, line.checkOut, line.rateCents].join("|");
        const before = offer.lines.map((line) => key({ ...line, checkIn: dayKey(line.checkIn), checkOut: dayKey(line.checkOut) }));
        const roomsChanged = before.join("\n") !== input.lines.map(key).join("\n") || input.currency !== offer.currency;
        // Blocked once the agreement has gone (or for an offer made before 2026-11-20, which blocked at once); requested before.
        let firm = offer.agreementSentOn !== null;
        for (const categoryId of new Set(offer.lines.map((line) => line.categoryId))) if ((await heldAs(tx, offer.salesRequestId, categoryId)) === "BLOCKED") firm = true;
        if (roomsChanged) {
          // The old rooms go back, then the new ones are taken the same way — in one step.
          await letGo(tx, actorId, offer.salesRequestId, offer.lines.map((line) => line.categoryId));
          await takeRooms(tx, actorId, offer.salesRequestId, input.lines, input.currency, input.validUntil, firm);
        } else if (validUntil.getTime() !== offer.validUntil.getTime()) {
          for (const categoryId of new Set(offer.lines.map((line) => line.categoryId))) {
            if ((await heldAs(tx, offer.salesRequestId, categoryId)) === "BLOCKED") {
              await changeRoomsTx(tx, actorId, { id: offer.salesRequestId, categoryId, state: "BLOCKED", action: "EXTEND_BLOCK", blockExpiry: input.validUntil });
            }
          }
        }
        await tx.offerLine.deleteMany({ where: { offerId: offer.id } });
        await tx.offerPayment.deleteMany({ where: { offerId: offer.id } });
        await tx.offerCancellation.deleteMany({ where: { offerId: offer.id } });
        await tx.offer.update({
          where: { id: offer.id },
          data: {
            currency: input.currency,
            validUntil,
            inclusions: blank(input.inclusions),
            conditions: blank(input.conditions),
            lines: {
              create: input.lines.map((line, position) => ({
                categoryId: line.categoryId,
                rooms: line.rooms,
                checkIn: parseDay(line.checkIn),
                checkOut: parseDay(line.checkOut),
                rateCents: line.rateCents,
                position,
              })),
            },
            payments: {
              create: input.payments.map((payment, position) => ({
                onSignature: payment.onSignature,
                dueOn: payment.onSignature || !payment.dueOn ? null : parseDay(payment.dueOn),
                percentBasisPoints: payment.percentBasisPoints,
                position,
              })),
            },
            cancellations: {
              create: input.cancellations.map((cut, position) => ({
                kind: cut.kind,
                cutoffOn: cut.cutoffOn ? parseDay(cut.cutoffOn) : null,
                percentBasisPoints: cut.percentBasisPoints,
                feeBasisPoints: cut.feeBasisPoints,
                rooms: cut.rooms,
                roomType: cut.rooms !== null ? cut.roomType.trim() || null : null,
                remarks: cut.remarks.trim() || null,
                position,
              })),
            },
          },
        });
        const total = offerTotal(input.lines.map((line) => ({ ...line, checkIn: parseDay(line.checkIn), checkOut: parseDay(line.checkOut) })));
        await tx.salesRequest.update({ where: { id: offer.salesRequestId }, data: { ...(firm && { blockedUntil: validUntil }), valueCents: total, valueCurrency: input.currency } });
        await logAudit(tx, {
          actorId,
          entity: "SalesRequest",
          entityId: offer.salesRequestId,
          summary: `Offer changed: ${input.lines.reduce((sum, line) => sum + line.rooms, 0)} rooms, ${formatMoney(total, input.currency)}, holding until ${formatDate(validUntil)}${roomsChanged ? (firm ? " — rooms re-blocked" : " — rooms requested afresh") : ""}`,
          changes: offer.agreementText !== null ? "The agreement's wording had been changed by hand: check it still matches." : undefined,
        });
        return { id: offer.id, agreementEdited: offer.agreementText !== null };
      },
      { timeout: 60_000 },
    ),
  ),

  /**
   * The offer's agreement to review (doc §4.11): as changed for this client,
   * or as the framework fills it — and that fresh filling, to go back to.
   */
  agreement: protectedProcedure.input(z.object({ id: z.string() })).query(async ({ ctx, input }) => {
    const { offer, request, filled } = await filledAgreement(ctx.db, input.id);
    return {
      id: offer.id,
      status: offer.status,
      salesRequestId: request.id,
      clientName: request.client.name,
      eventName: request.event!.name,
      /** An addendum's: the contract it adds to (doc §4.11). */
      amends: request.amendsContract?.name ?? null,
      validUntil: offer.validUntil,
      sentOn: offer.agreementSentOn,
      text: offer.agreementText ?? filled,
      edited: offer.agreementText !== null,
      filled,
    };
  }),

  /**
   * Share the offer with the client (doc §4.11, the owner 2026-11-27): a page
   * at a link of its own, which prints or saves as a PDF — the step before the
   * contracting. Sharing again keeps the same link.
   */
  share: protectedProcedure.input(z.object({ id: z.string() })).mutation(async ({ ctx, input }) => {
    const before = await ctx.db.offer.findUniqueOrThrow({ where: { id: input.id }, select: { status: true, shareToken: true, sharedAt: true } });
    if (before.status === "WITHDRAWN") throw new TRPCError({ code: "BAD_REQUEST", message: "This offer was withdrawn — make a new one to share." });
    if (before.shareToken) return { shareToken: before.shareToken };
    const offer = await ctx.db.offer.update({
      where: { id: input.id },
      data: { shareToken: randomBytes(24).toString("base64url"), sharedAt: before.sharedAt ?? new Date() },
      select: { shareToken: true, salesRequestId: true },
    });
    await logAudit(ctx.db, { actorId: ctx.session.user.id, entity: "SalesRequest", entityId: offer.salesRequestId, summary: "Offer shared with the client — link made" });
    return { shareToken: offer.shareToken! };
  }),

  /** Switch the offer's link off: the client's page says it is no longer shared. Sharing again makes a new link. */
  unshare: protectedProcedure.input(z.object({ id: z.string() })).mutation(async ({ ctx, input }) => {
    const offer = await ctx.db.offer.update({ where: { id: input.id }, data: { shareToken: null }, select: { salesRequestId: true } });
    await logAudit(ctx.db, { actorId: ctx.session.user.id, entity: "SalesRequest", entityId: offer.salesRequestId, summary: "Offer link switched off" });
    return { ok: true };
  }),

  /**
   * The offer as the client sees it, from its link — no sign-in. Only what we
   * offer them: the rooms at our rates, the terms and how long it holds;
   * never our buying rates.
   */
  shared: publicProcedure.input(z.object({ token: z.string().min(20).max(100) })).query(async ({ ctx, input }) => {
    const offer = await ctx.db.offer.findUnique({
      where: { shareToken: input.token },
      include: {
        ...include,
        salesRequest: { select: { tradeName: true, client: { select: { name: true } }, event: { select: { name: true, startDate: true, endDate: true } } } },
      },
    });
    if (!offer || offer.status === "WITHDRAWN") throw new TRPCError({ code: "NOT_FOUND", message: "This offer is not shared any more." });
    const lines = offer.lines.map((line) => {
      const nights = nightsBetween(line.checkIn, line.checkOut);
      return {
        id: line.id,
        property: line.category.property.name,
        city: line.category.property.city,
        roomType: line.category.name,
        rooms: line.rooms,
        checkIn: line.checkIn,
        checkOut: line.checkOut,
        nights,
        roomNights: nights * line.rooms,
        rateCents: line.rateCents,
        totalCents: nights * line.rooms * line.rateCents,
      };
    });
    const totalCents = offerTotal(offer.lines);
    const list = (text: string | null) => (text ?? "").split("\n").map((one) => one.trim()).filter(Boolean);
    return {
      clientName: offer.salesRequest.tradeName?.trim() || offer.salesRequest.client.name,
      event: offer.salesRequest.event,
      currency: offer.currency,
      validUntil: offer.validUntil,
      madeOn: offer.sharedAt ?? offer.createdAt,
      preparedBy: offer.createdBy?.name ?? null,
      status: offer.status,
      lines,
      totalCents,
      roomNights: lines.reduce((sum, line) => sum + line.roomNights, 0),
      payments: offer.payments.map((payment) => ({
        onSignature: payment.onSignature,
        dueOn: payment.dueOn,
        percentBasisPoints: payment.percentBasisPoints,
        amountCents: Math.round((totalCents * payment.percentBasisPoints) / 10_000),
      })),
      cancellations: offer.cancellations.map(cutSummary).filter(Boolean),
      inclusions: list(offer.inclusions),
      conditions: list(offer.conditions),
    };
  }),

  /** Change this client's agreement — or, with null, go back to the framework's filling. */
  saveAgreement: protectedProcedure.input(z.object({ id: z.string(), text: z.string().max(200_000).nullable() })).mutation(async ({ ctx, input }) => {
    const offer = await ctx.db.offer.update({ where: { id: input.id }, data: { agreementText: input.text?.trim() ? input.text : null } });
    await logAudit(ctx.db, {
      actorId: ctx.session.user.id,
      entity: "SalesRequest",
      entityId: offer.salesRequestId,
      summary: input.text ? "Agreement wording changed for this client" : "Agreement back to the framework's wording",
    });
  }),

  /** The agreement went to the client — by DocuSign, outside the system — on this day. */
  /**
   * The agreement went to the client — and so the offer's requested rooms are
   * blocked for them until the offer runs out (the owner, 2026-11-20: "once we
   * mark the agreement as sent, we can proceed with blocking"). All or
   * nothing: a room someone else blocked or sold meanwhile refuses it, saying
   * which, and nothing is marked. Unmarking leaves the rooms blocked; withdraw
   * the offer to let them go.
   */
  markSent: protectedProcedure.input(z.object({ id: z.string(), sentOn: day.nullable() })).mutation(({ ctx, input }) =>
    ctx.db.$transaction(
      async (tx) => {
        const actorId = ctx.session.user.id;
        const before = await tx.offer.findUniqueOrThrow({
          where: { id: input.id },
          include: { lines: { orderBy: { position: "asc" }, include: { category: { select: { name: true, property: { select: { name: true } } } } } } },
        });
        let blocked = false;
        if (input.sentOn && before.status === "OPEN" && !before.agreementSentOn) {
          for (const categoryId of new Set(before.lines.map((line) => line.categoryId))) {
            if ((await heldAs(tx, before.salesRequestId, categoryId)) !== "REQUESTED") continue;
            const line = before.lines.find((one) => one.categoryId === categoryId)!;
            try {
              await changeRoomsTx(tx, actorId, { id: before.salesRequestId, categoryId, state: "REQUESTED", action: "BLOCK", blockExpiry: dayKey(before.validUntil) });
            } catch {
              // Some of the requested rooms were blocked or sold to someone else meanwhile: block any free ones of the type instead.
              try {
                await changeRoomsTx(tx, actorId, { id: before.salesRequestId, categoryId, state: "REQUESTED", action: "WITHDRAW_REQUEST" });
                const lines = before.lines.filter((one) => one.categoryId === categoryId);
                await takeRooms(
                  tx,
                  actorId,
                  before.salesRequestId,
                  lines.map((one) => ({ categoryId, rooms: one.rooms, checkIn: dayKey(one.checkIn), checkOut: dayKey(one.checkOut), rateCents: one.rateCents })),
                  before.currency,
                  dayKey(before.validUntil),
                  true,
                );
              } catch (error) {
                const why = (error instanceof Error ? error.message : "").replace(/^Nothing was changed\.\s*/, "").replace(/\.$/, "");
                throw new TRPCError({
                  code: "BAD_REQUEST",
                  message: `Nothing was changed — the ${line.category.name} rooms at ${line.category.property.name} could not be blocked: ${why || "they are no longer free"}. Edit the offer, then mark it sent.`,
                });
              }
            }
            blocked = true;
          }
          if (blocked) await tx.salesRequest.update({ where: { id: before.salesRequestId }, data: { blockedUntil: before.validUntil } });
        }
        const offer = await tx.offer.update({ where: { id: input.id }, data: { agreementSentOn: input.sentOn ? parseDay(input.sentOn) : null } });
        await logAudit(tx, {
          actorId,
          entity: "SalesRequest",
          entityId: offer.salesRequestId,
          summary: input.sentOn
            ? `Agreement sent to the client on ${formatDate(parseDay(input.sentOn))}${blocked ? ` — rooms blocked until ${formatDate(before.validUntil)}` : ""}`
            : "Agreement no longer marked as sent — its rooms stay blocked",
        });
        return { blocked };
      },
      { timeout: 60_000 },
    ),
  ),

  /** An agreement's wording, for every client — or every hotel at a US event (doc §4.11). */
  template: protectedProcedure.input(z.object({ kind: agreementKind })).query(async ({ ctx, input }) => {
    const framework = await frameworkText(ctx.db, input.kind);
    return { ...framework, original: AGREEMENT_TEMPLATES[input.kind] };
  }),

  /** Change an agreement's wording — or, with null, go back to the original. */
  saveTemplate: protectedProcedure.input(z.object({ kind: agreementKind, text: z.string().max(200_000).nullable() })).mutation(async ({ ctx, input }) => {
    if (input.text === null || input.text.trim() === AGREEMENT_TEMPLATES[input.kind].trim()) {
      await ctx.db.agreementTemplate.deleteMany({ where: { id: input.kind } });
    } else {
      await ctx.db.agreementTemplate.upsert({
        where: { id: input.kind },
        create: { id: input.kind, text: input.text, updatedById: ctx.session.user.id },
        update: { text: input.text, updatedById: ctx.session.user.id },
      });
    }
  }),

  /** The client signed and sent the agreement back (doc §4.11). */
  sign: protectedProcedure
    .input(z.object({ id: z.string(), signedOn: day, documentUrl: z.string().trim().max(2000) }))
    .mutation(async ({ ctx, input }) => {
      const contract = await ctx.db.$transaction(
        (tx) =>
          closeOffer(tx, { id: ctx.session.user.id, name: ctx.session.user.name ?? null }, input.id, {
            signed: true,
            signedOn: parseDay(input.signedOn),
            documentUrl: input.documentUrl || null,
          }),
        { timeout: 60_000 },
      );
      await deliverImmediate(ctx.db);
      return { contractId: contract.id };
    }),

  /**
   * The trust guarantee (doc §4.11): an admin — Volki — vouches that the client
   * will sign, so their rooms are sold and the hotels secured now.
   */
  trust: protectedProcedure.input(z.object({ id: z.string() })).mutation(async ({ ctx, input }) => {
    if (!canTrust(ctx.session.user.email)) throw new TRPCError({ code: "FORBIDDEN", message: "Only Volki can give the trust guarantee." });
    const contract = await ctx.db.$transaction((tx) => closeOffer(tx, { id: ctx.session.user.id, name: ctx.session.user.name ?? null }, input.id, { signed: false }), {
      timeout: 60_000,
    });
    await deliverImmediate(ctx.db);
    return { contractId: contract.id };
  }),

  /** For the contract task (doc §4.11): are the contracting details in, and the answer to make the offer from. */
  contractTask: protectedProcedure.input(z.object({ salesRequestId: z.string() })).query(async ({ ctx, input }) => {
    const [request, answer] = await Promise.all([
      ctx.db.salesRequest.findUniqueOrThrow({ where: { id: input.salesRequestId }, select: { id: true, tradeName: true, signatory1Name: true } }),
      ctx.db.rateCardResponse.findFirst({
        where: { salesRequestId: input.salesRequestId, items: { some: {} } },
        orderBy: { createdAt: "desc" },
        select: { id: true },
      }),
    ]);
    return { tradeName: request.tradeName, signatory: request.signatory1Name, responseId: answer?.id ?? null };
  }),

  /**
   * The hotels behind a signed offer (doc §4.11): for each, its acquire task
   * and its contract — pending, or signed and the rooms bought.
   */
  hotels: protectedProcedure.input(z.object({ salesRequestId: z.string() })).query(async ({ ctx, input }) => {
    const lines = await ctx.db.offerLine.findMany({
      where: { offer: { salesRequestId: input.salesRequestId, status: { in: ["SIGNED", "TRUSTED"] } } },
      select: { category: { select: { property: { select: { id: true, name: true } } } } },
    });
    const properties = [...new Map(lines.map((line) => [line.category.property.id, line.category.property])).values()];
    return Promise.all(
      properties.map(async (property) => {
        const [task, contracts] = await Promise.all([
          ctx.db.task.findFirst({
            where: { salesRequestId: input.salesRequestId, propertyId: property.id, type: { name: "Acquire" } },
            orderBy: { createdAt: "desc" },
            select: { id: true, status: true, assignees: { select: { name: true } } },
          }),
          ctx.db.contract.findMany({
            where: { party: "SUPPLIER", propertyId: property.id, salesRequestId: input.salesRequestId },
            orderBy: { createdAt: "desc" },
            select: { id: true, name: true, signedOn: true, eventId: true },
          }),
        ]);
        return { ...property, task, contract: contracts.find((contract) => contract.signedOn) ?? contracts[0] ?? null };
      }),
    );
  }),

  /** A client vouched for has now signed: their contract gets its date and the signed copy. */
  signedAfterTrust: protectedProcedure
    .input(z.object({ id: z.string(), signedOn: day, documentUrl: z.string().trim().max(2000) }))
    .mutation(async ({ ctx, input }) => {
      const offer = await ctx.db.offer.findUniqueOrThrow({ where: { id: input.id }, select: { status: true, contractId: true, salesRequestId: true } });
      if (offer.status !== "TRUSTED" || !offer.contractId) throw new TRPCError({ code: "BAD_REQUEST", message: "Only a trusted offer waits for its signature." });
      await ctx.db.contract.update({ where: { id: offer.contractId }, data: { signedOn: parseDay(input.signedOn), documentUrl: input.documentUrl || null } });
      await ctx.db.offer.update({ where: { id: input.id }, data: { status: "SIGNED" } });
      await logAudit(ctx.db, {
        actorId: ctx.session.user.id,
        entity: "SalesRequest",
        entityId: offer.salesRequestId,
        summary: `Agreement signed by the client on ${formatDate(parseDay(input.signedOn))}, after the trust guarantee`,
      });
    }),

  /** Hold the rooms longer: the offer and its blocks run to the new date. */
  extend: protectedProcedure.input(z.object({ id: z.string(), validUntil: day })).mutation(({ ctx, input }) =>
    ctx.db.$transaction(
      async (tx) => {
        const offer = await tx.offer.findUniqueOrThrow({ where: { id: input.id }, include: { lines: { select: { categoryId: true } } } });
        if (offer.status !== "OPEN") throw new TRPCError({ code: "BAD_REQUEST", message: "Only an open offer can be extended." });
        const validUntil = parseDay(input.validUntil);
        if (validUntil < today()) throw new TRPCError({ code: "BAD_REQUEST", message: "Extend it to today or later." });
        // Blocks run to the new date; rooms still only requested have no date to move.
        let blocked = false;
        for (const categoryId of new Set(offer.lines.map((line) => line.categoryId))) {
          if ((await heldAs(tx, offer.salesRequestId, categoryId)) !== "BLOCKED") continue;
          await changeRoomsTx(tx, ctx.session.user.id, { id: offer.salesRequestId, categoryId, state: "BLOCKED", action: "EXTEND_BLOCK", blockExpiry: input.validUntil });
          blocked = true;
        }
        await tx.offer.update({ where: { id: offer.id }, data: { validUntil } });
        if (blocked) await tx.salesRequest.update({ where: { id: offer.salesRequestId }, data: { blockedUntil: validUntil } });
        await logAudit(tx, {
          actorId: ctx.session.user.id,
          entity: "SalesRequest",
          entityId: offer.salesRequestId,
          summary: `Offer extended: holding until ${formatDate(validUntil)} (was ${formatDate(offer.validUntil)})`,
        });
      },
      { timeout: 60_000 },
    ),
  ),

  /** Take the offer back: its rooms are released for others. */
  withdraw: protectedProcedure.input(z.object({ id: z.string() })).mutation(({ ctx, input }) =>
    ctx.db.$transaction(
      async (tx) => {
        const offer = await tx.offer.findUniqueOrThrow({ where: { id: input.id }, include: { lines: { select: { categoryId: true } } } });
        if (offer.status !== "OPEN") throw new TRPCError({ code: "BAD_REQUEST", message: "Only an open offer can be withdrawn." });
        await letGo(tx, ctx.session.user.id, offer.salesRequestId, offer.lines.map((line) => line.categoryId));
        await tx.offer.update({ where: { id: offer.id }, data: { status: "WITHDRAWN" } });
        await tx.salesRequest.update({ where: { id: offer.salesRequestId }, data: { blockedUntil: null } });
        await logAudit(tx, { actorId: ctx.session.user.id, entity: "SalesRequest", entityId: offer.salesRequestId, summary: "Offer withdrawn: its rooms released" });
      },
      { timeout: 60_000 },
    ),
  ),
});
