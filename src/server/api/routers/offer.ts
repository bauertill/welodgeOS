import { TRPCError } from "@trpc/server";
import { z } from "zod";

import type { PrismaClient } from "generated/prisma";

import { fillAgreement, type AgreementData } from "~/lib/agreement";
import { DEFAULT_AGREEMENT_TEMPLATE } from "~/lib/agreement-template";
import { addDays, dayKey, nightsBetween, parseDay, today } from "~/lib/dates";
import { formatDate, formatMoney } from "~/lib/format";
import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";
import { cancellationInput, paymentInput } from "~/server/api/routers/quotation";
import { addRoomsTx, changeRoomsTx, moveStage } from "~/server/api/routers/sales";
import { logAudit } from "~/server/audit";

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
};

const blank = (value: string) => (value.trim() ? value.trim() : null);

/** An offer's total: every line's rooms × nights × rate. */
export const offerTotal = (lines: { rooms: number; checkIn: Date; checkOut: Date; rateCents: number }[]) =>
  lines.reduce((sum, line) => sum + line.rooms * nightsBetween(line.checkIn, line.checkOut) * line.rateCents, 0);

const TEMPLATE_ID = "framework";

/** The framework agreement's wording: as the team last changed it, else the original. */
async function frameworkText(db: PrismaClient) {
  const saved = await db.agreementTemplate.findUnique({ where: { id: TEMPLATE_ID }, include: { updatedBy: { select: { name: true } } } });
  return { text: saved?.text ?? DEFAULT_AGREEMENT_TEMPLATE, changed: saved ? { at: saved.updatedAt, by: saved.updatedBy?.name ?? null } : null };
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
          event: { select: { name: true, startDate: true, endDate: true } },
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
        rateCards: {
          orderBy: { createdAt: "desc" },
          select: {
            currency: true,
            properties: { select: { propertyId: true } },
            responses: {
              orderBy: { createdAt: "desc" },
              select: {
                id: true,
                createdAt: true,
                items: { select: { rooms: true, checkIn: true, checkOut: true, sellingCents: true, line: { select: { categoryId: true } } } },
              },
            },
          },
        },
      },
    });
    if (!request.eventId) throw new TRPCError({ code: "BAD_REQUEST", message: "Choose the event under Details first — an offer's rooms belong to an event." });
    const responses = request.rateCards.flatMap((card) => card.responses.map((response) => ({ ...response, currency: card.currency })));
    const answer =
      (input.responseId ? responses.find((response) => response.id === input.responseId) : null) ??
      responses.filter((response) => response.items.length).sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0] ??
      null;
    const onCards = new Set(request.rateCards.flatMap((card) => card.properties.map((property) => property.propertyId)));
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
   * Make an offer: its rooms are blocked for the client until it runs out,
   * through the same rules, ledger and undo as the stock sheet — all or
   * nothing — and the request moves to Negotiation.
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
                cutoffOn: parseDay(cut.cutoffOn),
                percentBasisPoints: cut.percentBasisPoints,
                feeBasisPoints: cut.feeBasisPoints,
                remarks: cut.remarks.trim() || null,
                position,
              })),
            },
          },
        });
        // The rooms, blocked until the offer runs out — or nothing is made.
        for (const line of input.lines) {
          await addRoomsTx(tx, actorId, {
            id: input.salesRequestId,
            categoryId: line.categoryId,
            rooms: line.rooms,
            checkIn: line.checkIn,
            checkOut: line.checkOut,
            action: "BLOCK",
            blockExpiry: input.validUntil,
            sellPriceCents: line.rateCents,
            sellCurrency: input.currency,
          });
        }
        const total = offerTotal(input.lines.map((line) => ({ ...line, checkIn: parseDay(line.checkIn), checkOut: parseDay(line.checkOut) })));
        await tx.salesRequest.update({
          where: { id: input.salesRequestId },
          data: { blockedUntil: validUntil, valueCents: total, valueCurrency: input.currency },
        });
        await logAudit(tx, {
          actorId,
          entity: "SalesRequest",
          entityId: input.salesRequestId,
          summary: `Offer made: ${input.lines.reduce((sum, line) => sum + line.rooms, 0)} rooms, ${formatMoney(total, input.currency)}, holding until ${formatDate(validUntil)}`,
        });
        if (["INITIAL_INTEREST", "SPECIFY", "PROPOSAL_SENT"].includes(request.stage)) await moveStage(tx, actorId, input.salesRequestId, "NEGOTIATION");
        return { id: offer.id };
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
      validUntil: offer.validUntil,
      sentOn: offer.agreementSentOn,
      text: offer.agreementText ?? filled,
      edited: offer.agreementText !== null,
      filled,
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
  markSent: protectedProcedure.input(z.object({ id: z.string(), sentOn: day.nullable() })).mutation(async ({ ctx, input }) => {
    const offer = await ctx.db.offer.update({ where: { id: input.id }, data: { agreementSentOn: input.sentOn ? parseDay(input.sentOn) : null } });
    await logAudit(ctx.db, {
      actorId: ctx.session.user.id,
      entity: "SalesRequest",
      entityId: offer.salesRequestId,
      summary: input.sentOn ? `Agreement sent to the client on ${formatDate(parseDay(input.sentOn))}` : "Agreement no longer marked as sent",
    });
  }),

  /** The framework agreement's wording, for every client (doc §4.11). */
  template: protectedProcedure.query(async ({ ctx }) => {
    const framework = await frameworkText(ctx.db);
    return { ...framework, original: DEFAULT_AGREEMENT_TEMPLATE };
  }),

  /** Change the framework's wording — or, with null, go back to the original. */
  saveTemplate: protectedProcedure.input(z.object({ text: z.string().max(200_000).nullable() })).mutation(async ({ ctx, input }) => {
    if (input.text === null || input.text.trim() === DEFAULT_AGREEMENT_TEMPLATE.trim()) {
      await ctx.db.agreementTemplate.deleteMany({ where: { id: TEMPLATE_ID } });
    } else {
      await ctx.db.agreementTemplate.upsert({
        where: { id: TEMPLATE_ID },
        create: { id: TEMPLATE_ID, text: input.text, updatedById: ctx.session.user.id },
        update: { text: input.text, updatedById: ctx.session.user.id },
      });
    }
  }),

  /** Hold the rooms longer: the offer and its blocks run to the new date. */
  extend: protectedProcedure.input(z.object({ id: z.string(), validUntil: day })).mutation(({ ctx, input }) =>
    ctx.db.$transaction(
      async (tx) => {
        const offer = await tx.offer.findUniqueOrThrow({ where: { id: input.id }, include: { lines: { select: { categoryId: true } } } });
        if (offer.status !== "OPEN") throw new TRPCError({ code: "BAD_REQUEST", message: "Only an open offer can be extended." });
        const validUntil = parseDay(input.validUntil);
        if (validUntil < today()) throw new TRPCError({ code: "BAD_REQUEST", message: "Extend it to today or later." });
        for (const categoryId of new Set(offer.lines.map((line) => line.categoryId))) {
          await changeRoomsTx(tx, ctx.session.user.id, { id: offer.salesRequestId, categoryId, state: "BLOCKED", action: "EXTEND_BLOCK", blockExpiry: input.validUntil });
        }
        await tx.offer.update({ where: { id: offer.id }, data: { validUntil } });
        await tx.salesRequest.update({ where: { id: offer.salesRequestId }, data: { blockedUntil: validUntil } });
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
        for (const categoryId of new Set(offer.lines.map((line) => line.categoryId))) {
          const held = await tx.roomNight.count({ where: { salesRequestId: offer.salesRequestId, salesState: "BLOCKED", slot: { categoryId } } });
          if (held) await changeRoomsTx(tx, ctx.session.user.id, { id: offer.salesRequestId, categoryId, state: "BLOCKED", action: "RELEASE_HOLD" });
        }
        await tx.offer.update({ where: { id: offer.id }, data: { status: "WITHDRAWN" } });
        await tx.salesRequest.update({ where: { id: offer.salesRequestId }, data: { blockedUntil: null } });
        await logAudit(tx, { actorId: ctx.session.user.id, entity: "SalesRequest", entityId: offer.salesRequestId, summary: "Offer withdrawn: its rooms released" });
      },
      { timeout: 60_000 },
    ),
  ),
});
