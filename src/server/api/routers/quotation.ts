import { CancellationKind, Cleaning, QuotationStatus, RateInclusion, type Prisma } from "generated/prisma";
import { TRPCError } from "@trpc/server";
import { z } from "zod";

import { nightsBetween, parseDay, today } from "~/lib/dates";
import { percent } from "~/lib/finance";
import { formatDate, formatMoney } from "~/lib/format";
import { describeRateIncludes } from "~/lib/scouting";
import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";
import { openStages } from "~/lib/sales";
import { logAudit } from "~/server/audit";
import { HOTEL_CONTACT } from "~/server/hotel-contact";
import { notify } from "~/server/notify";
import { taskStatusLabels } from "~/lib/tasks";

/**
 * Quotations (doc §3.10): what a hotel offered for an event, kept apart from
 * what the hotel is. A hotel can send several — different periods, different
 * numbers of rooms, different groups — so each is a scenario of its own, made
 * of lines: rooms of one category, for one period, at one rate. Totals are
 * worked out when read; an accepted quotation becomes the supplier contract.
 */

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Give the date");
const optionalDay = z.string().regex(/^(\d{4}-\d{2}-\d{2})?$/, "That date does not look right");
const blank = (value: string | undefined) => (value?.trim() ? value.trim() : null);
const toDay = (value: string | undefined) => (value ? parseDay(value) : null);

const lineInput = z.object({
  categoryId: z.string(),
  checkIn: day,
  checkOut: day,
  rooms: z.number().int().min(1, "Each line needs at least one room").max(10_000),
  rateCents: z.number().int().min(0),
  occupancy: z.number().int().min(1).max(20).nullable(),
});

/** A payment as quoted: on signature, or on a date — a share of the total. */
export const paymentInput = z
  .object({
    onSignature: z.boolean(),
    dueOn: optionalDay,
    percentBasisPoints: z.number().int().min(1, "Each payment needs its percentage, like 20").max(10_000),
  })
  .refine((payment) => payment.onSignature || payment.dueOn, "Each payment is due on signature or on a date — give the date");

/** A cancellation cut-off as quoted: by this date, this share. */
export const cancellationInput = z.object({
  kind: z.nativeEnum(CancellationKind),
  cutoffOn: day,
  percentBasisPoints: z.number().int().min(0).max(10_000).nullable(),
  feeBasisPoints: z.number().int().min(0).max(10_000).nullable(),
  remarks: z.string().max(500),
});

const quotationInput = z.object({
  name: z.string().trim().min(1, "Give the quotation a name — the group or scenario, like Austria House staff").max(300),
  receivedOn: optionalDay,
  validUntil: optionalDay,
  rooms: z.number().int().min(0).max(100_000).nullable(),
  currency: z.string().length(3),
  paymentTerms: z.string().max(5000),
  cancellationTerms: z.string().max(5000),
  rateIncludes: z.array(z.nativeEnum(RateInclusion)),
  rateIncludesOther: z.string().max(2000),
  cleaning: z.nativeEnum(Cleaning).nullable(),
  cleaningOther: z.string().max(500),
  totBasisPoints: z.number().int().min(0).max(10_000).nullable(),
  otherTaxes: z.string().max(2000),
  documentUrl: z
    .string()
    .trim()
    .max(2000)
    .refine((value) => value === "" || /^https?:\/\//.test(value), "Paste the whole link, starting with https://"),
  notes: z.string().max(5000),
  /** The client's request it was quoted for, if one (doc §4.11). */
  salesRequestId: z.string().nullable().default(null),
  /** Whose agreement the contract will be on — the hotel's or ours; null while not known (doc §4.11). */
  agreementOn: z.enum(["HOTEL", "WE_LODGE"]).nullable().default(null),
  payments: z.array(paymentInput).max(20).default([]),
  cancellations: z.array(cancellationInput).max(20).default([]),
  lines: z.array(lineInput).min(1, "Add at least one line — rooms of a category, for a period, at a rate.").max(200),
});

const include = {
  lines: {
    orderBy: [{ position: "asc" }, { checkIn: "asc" }],
    include: { category: { select: { id: true, name: true } } },
  },
  payments: { orderBy: { position: "asc" } },
  cancellations: { orderBy: { position: "asc" } },
  contract: { select: { id: true, name: true, eventId: true } },
  addedBy: { select: { name: true, email: true } },
  salesRequest: { select: { id: true, client: { select: { name: true } } } },
} satisfies Prisma.QuotationInclude;

type Loaded = Prisma.QuotationGetPayload<{ include: typeof include }>;

/** What a quotation comes to, line by line and in all — worked out, never stored. */
function withTotals(quotation: Loaded) {
  const lines = quotation.lines.map((line) => {
    const nights = nightsBetween(line.checkIn, line.checkOut);
    return { ...line, nights, roomNights: nights * line.rooms, totalCents: nights * line.rooms * line.rateCents };
  });
  const starts = lines.map((line) => line.checkIn.getTime());
  const ends = lines.map((line) => line.checkOut.getTime());
  return {
    ...quotation,
    lines,
    roomNights: lines.reduce((sum, line) => sum + line.roomNights, 0),
    totalCents: lines.reduce((sum, line) => sum + line.totalCents, 0),
    from: starts.length ? new Date(Math.min(...starts)) : null,
    to: ends.length ? new Date(Math.max(...ends)) : null,
  };
}

/** Once a quotation has become a contract, it stays accepted and on the board. */
async function refuseOnceContracted(db: Prisma.TransactionClient, id: string, refuse: boolean) {
  if (!refuse) return;
  const quotation = await db.quotation.findUniqueOrThrow({ where: { id }, select: { contractId: true } });
  if (quotation.contractId) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "This quotation has become a contract, so it stays accepted. Change the contract instead." });
  }
}

export const quotationRouter = createTRPCRouter({
  /** A hotel's quotations for an event, newest first, with their totals. */
  forEntry: protectedProcedure.input(z.object({ scoutingEntryId: z.string() })).query(async ({ ctx, input }) => {
    const quotations = await ctx.db.quotation.findMany({
      where: { scoutingEntryId: input.scoutingEntryId },
      orderBy: [{ createdAt: "desc" }],
      include,
    });
    return quotations.map(withTotals);
  }),

  /**
   * The client requests a quotation on this hotel can be for: the open ones on
   * its event. The one its open hotel contact task is about comes first, as
   * the likely one (doc §4.11).
   */
  requestsFor: protectedProcedure.input(z.object({ scoutingEntryId: z.string() })).query(async ({ ctx, input }) => {
    const entry = await ctx.db.scoutingEntry.findUniqueOrThrow({ where: { id: input.scoutingEntryId }, select: { eventId: true, propertyId: true } });
    const [requests, task] = await Promise.all([
      ctx.db.salesRequest.findMany({
        where: { eventId: entry.eventId, stage: { in: openStages } },
        orderBy: { createdAt: "desc" },
        select: { id: true, client: { select: { name: true } }, description: true },
      }),
      ctx.db.task.findFirst({
        where: { propertyId: entry.propertyId, eventId: entry.eventId, salesRequestId: { not: null }, status: { not: "DONE" }, type: { name: HOTEL_CONTACT } },
        orderBy: { createdAt: "desc" },
        select: { salesRequestId: true },
      }),
    ]);
    return { requests: requests.map((request) => ({ id: request.id, name: request.client.name, description: request.description })), likely: task?.salesRequestId ?? null };
  }),

  /** The quotations hotels sent for one client request, newest first (doc §4.11) — on its sourcing task and its page. */
  forRequest: protectedProcedure.input(z.object({ salesRequestId: z.string() })).query(async ({ ctx, input }) => {
    const quotations = await ctx.db.quotation.findMany({
      where: { salesRequestId: input.salesRequestId },
      orderBy: [{ createdAt: "desc" }],
      include: { ...include, scoutingEntry: { select: { eventId: true, property: { select: { id: true, name: true } } } } },
    });
    return quotations.map((quotation) => ({
      ...withTotals(quotation),
      property: quotation.scoutingEntry.property,
      eventId: quotation.scoutingEntry.eventId,
      lowestRateCents: quotation.lines.length ? Math.min(...quotation.lines.map((line) => line.rateCents)) : null,
    }));
  }),

  /** What the quotation form needs outside the property's page: its room categories and the event's dates (doc §4.11). */
  formContext: protectedProcedure.input(z.object({ scoutingEntryId: z.string() })).query(async ({ ctx, input }) => {
    const entry = await ctx.db.scoutingEntry.findUniqueOrThrow({
      where: { id: input.scoutingEntryId },
      select: {
        event: { select: { name: true, startDate: true, endDate: true } },
        property: { select: { id: true, name: true, categories: { orderBy: { sortOrder: "asc" }, select: { id: true, name: true } } } },
      },
    });
    return entry;
  }),

  /** Add a quotation, or change one — its lines are replaced by the ones given. */
  save: protectedProcedure
    .input(z.object({ scoutingEntryId: z.string(), id: z.string().optional(), quotation: quotationInput }))
    .mutation(({ ctx, input }) =>
      ctx.db.$transaction(async (tx) => {
        const entry = await tx.scoutingEntry.findUniqueOrThrow({
          where: { id: input.scoutingEntryId },
          select: { propertyId: true, eventId: true, property: { select: { name: true, categories: { select: { id: true } } } } },
        });
        if (input.quotation.salesRequestId) {
          const request = await tx.salesRequest.findUnique({ where: { id: input.quotation.salesRequestId }, select: { eventId: true } });
          if (request?.eventId !== entry.eventId) throw new TRPCError({ code: "BAD_REQUEST", message: "That sales request is not for this event." });
        }
        const own = new Set(entry.property.categories.map((category) => category.id));
        const { lines, payments, cancellations, ...fields } = input.quotation;
        for (const line of lines) {
          if (!own.has(line.categoryId)) {
            throw new TRPCError({ code: "BAD_REQUEST", message: "Every line must be one of this hotel's own room categories." });
          }
          if (line.checkOut <= line.checkIn) {
            throw new TRPCError({ code: "BAD_REQUEST", message: "Each line's check-out must be after its check-in." });
          }
        }
        const data = {
          name: fields.name,
          receivedOn: toDay(fields.receivedOn),
          validUntil: toDay(fields.validUntil),
          rooms: fields.rooms,
          currency: fields.currency,
          paymentTerms: blank(fields.paymentTerms),
          cancellationTerms: blank(fields.cancellationTerms),
          rateIncludes: [...new Set(fields.rateIncludes)],
          rateIncludesOther: blank(fields.rateIncludesOther),
          cleaning: fields.cleaning,
          cleaningOther: fields.cleaning === "OTHER" ? blank(fields.cleaningOther) : null,
          totBasisPoints: fields.totBasisPoints,
          otherTaxes: blank(fields.otherTaxes),
          documentUrl: blank(fields.documentUrl),
          notes: blank(fields.notes),
          salesRequestId: fields.salesRequestId,
          agreementOn: fields.agreementOn,
        };
        const before = input.id ? await tx.quotation.findUnique({ where: { id: input.id }, select: { scoutingEntryId: true, salesRequestId: true } }) : null;
        if (input.id && before?.scoutingEntryId !== input.scoutingEntryId) {
          throw new TRPCError({ code: "NOT_FOUND", message: "That quotation is not this hotel's." });
        }
        const saved = input.id
          ? await tx.quotation.update({ where: { id: input.id }, data })
          : await tx.quotation.create({ data: { ...data, scoutingEntryId: input.scoutingEntryId, addedById: ctx.session.user.id } });
        // Their quote is in: the hotel's contact task, if not yet started, is now in progress (doc §4.11).
        if (!input.id) {
          const started = await tx.task.findMany({
            where: { propertyId: entry.propertyId, eventId: entry.eventId, status: { in: ["BACKLOG", "TODO"] }, type: { name: HOTEL_CONTACT } },
            select: { id: true, title: true, status: true, requestedById: true, assignees: { select: { id: true } } },
          });
          for (const task of started) {
            await tx.task.update({ where: { id: task.id }, data: { status: "IN_PROGRESS" } });
            await logAudit(tx, {
              actorId: ctx.session.user.id,
              entity: "Task",
              entityId: task.id,
              summary: `In progress — their quote came in: ${fields.name}`,
              changes: `Status: ${taskStatusLabels[task.status]} → ${taskStatusLabels.IN_PROGRESS}`,
            });
            await notify(tx, {
              to: [task.requestedById, ...task.assignees.map((person) => person.id)],
              actorId: ctx.session.user.id,
              kind: "TASK_STATUS",
              title: `"${task.title}" is in progress — the hotel's quote came in`,
              link: `/tasks/${task.id}`,
              taskId: task.id,
            });
          }
        }
        // Its payments and cut-offs, like its lines, are replaced as a whole.
        await tx.quotationPayment.deleteMany({ where: { quotationId: saved.id } });
        await tx.quotationPayment.createMany({
          data: payments.map((payment, position) => ({
            quotationId: saved.id,
            onSignature: payment.onSignature,
            dueOn: payment.onSignature ? null : toDay(payment.dueOn),
            percentBasisPoints: payment.percentBasisPoints,
            position,
          })),
        });
        await tx.quotationCancellation.deleteMany({ where: { quotationId: saved.id } });
        await tx.quotationCancellation.createMany({
          data: cancellations.map((cut, position) => ({
            quotationId: saved.id,
            kind: cut.kind,
            cutoffOn: parseDay(cut.cutoffOn),
            percentBasisPoints: cut.percentBasisPoints,
            feeBasisPoints: cut.feeBasisPoints,
            remarks: blank(cut.remarks),
            position,
          })),
        });
        // The lines are the quotation's own rows: replaced as a whole.
        await tx.quotationLine.deleteMany({ where: { quotationId: saved.id } });
        await tx.quotationLine.createMany({
          data: lines.map((line, position) => ({
            quotationId: saved.id,
            categoryId: line.categoryId,
            checkIn: parseDay(line.checkIn),
            checkOut: parseDay(line.checkOut),
            rooms: line.rooms,
            rateCents: line.rateCents,
            occupancy: line.occupancy,
            position,
          })),
        });
        const full = withTotals(await tx.quotation.findUniqueOrThrow({ where: { id: saved.id }, include }));
        // On the request's history too, once tied to it (doc §4.11).
        if (fields.salesRequestId && fields.salesRequestId !== before?.salesRequestId) {
          await logAudit(tx, {
            actorId: ctx.session.user.id,
            entity: "SalesRequest",
            entityId: fields.salesRequestId,
            summary: `Quotation from ${entry.property.name}: ${full.name}`,
            changes: `${full.roomNights} room-nights · ${formatMoney(full.totalCents, full.currency)}`,
          });
        }
        await logAudit(tx, {
          actorId: ctx.session.user.id,
          entity: "ScoutingEntry",
          entityId: input.scoutingEntryId,
          summary: `${input.id ? "Quotation updated" : "Quotation added"}: ${full.name}`,
          changes: `${full.roomNights} room-nights · ${formatMoney(full.totalCents, full.currency)}${
            full.from && full.to ? ` · ${formatDate(full.from)} – ${formatDate(full.to)}` : ""
          }`,
        });
        return full;
      }),
    ),

  /** Accept a quotation, decline it, or put it back to received. */
  setStatus: protectedProcedure
    .input(z.object({ id: z.string(), status: z.nativeEnum(QuotationStatus) }))
    .mutation(async ({ ctx, input }) => {
      await refuseOnceContracted(ctx.db, input.id, input.status !== "ACCEPTED");
      const saved = await ctx.db.quotation.update({ where: { id: input.id }, data: { status: input.status } });
      await logAudit(ctx.db, {
        actorId: ctx.session.user.id,
        entity: "ScoutingEntry",
        entityId: saved.scoutingEntryId,
        summary: `Quotation ${input.status === "ACCEPTED" ? "accepted" : input.status === "DECLINED" ? "declined" : "back to received"}: ${saved.name}`,
      });
      return saved;
    }),

  remove: protectedProcedure.input(z.object({ id: z.string() })).mutation(async ({ ctx, input }) => {
    await refuseOnceContracted(ctx.db, input.id, true);
    const removed = await ctx.db.quotation.delete({ where: { id: input.id } });
    await logAudit(ctx.db, {
      actorId: ctx.session.user.id,
      entity: "ScoutingEntry",
      entityId: removed.scoutingEntryId,
      summary: `Quotation removed: ${removed.name}`,
    });
  }),

  /**
   * Turn an accepted quotation into the supplier contract (doc §7.1): for this
   * hotel and event, worth the quotation's total, with its PDF link and its
   * terms carried over as notes until they are entered as payments and
   * cut-offs. The quotation is marked accepted and points at its contract.
   */
  /** Whose agreement the hotel's contract will be on — theirs or ours; null while not known (doc §4.11). */
  setAgreementOn: protectedProcedure
    .input(z.object({ id: z.string(), agreementOn: z.enum(["HOTEL", "WE_LODGE"]).nullable() }))
    .mutation(async ({ ctx, input }) => {
      const quotation = await ctx.db.quotation.update({ where: { id: input.id }, data: { agreementOn: input.agreementOn }, select: { scoutingEntryId: true, name: true } });
      await logAudit(ctx.db, {
        actorId: ctx.session.user.id,
        entity: "ScoutingEntry",
        entityId: quotation.scoutingEntryId,
        summary: `${quotation.name}: contract on ${input.agreementOn === "HOTEL" ? "the hotel's agreement" : input.agreementOn === "WE_LODGE" ? "our agreement" : "— not known yet"}`,
      });
    }),

  makeContract: protectedProcedure.input(z.object({ id: z.string() })).mutation(({ ctx, input }) =>
    ctx.db.$transaction(async (tx) => {
      const quotation = withTotals(await tx.quotation.findUniqueOrThrow({ where: { id: input.id }, include }));
      if (quotation.contract) return quotation.contract;
      const entry = await tx.scoutingEntry.findUniqueOrThrow({
        where: { id: quotation.scoutingEntryId },
        select: { eventId: true, propertyId: true, accountManagerId: true, property: { select: { name: true } } },
      });
      const terms = [
        `From the quotation "${quotation.name}"${quotation.receivedOn ? ` received ${formatDate(quotation.receivedOn)}` : ""}.`,
        quotation.paymentTerms ? `Payment terms as quoted: ${quotation.paymentTerms}` : null,
        quotation.cancellationTerms ? `Cancellation terms as quoted: ${quotation.cancellationTerms}` : null,
        (() => {
          const includes = describeRateIncludes(quotation.rateIncludes, quotation.rateIncludesOther, quotation.cleaning, quotation.cleaningOther);
          return includes ? `Rates include: ${includes}` : null;
        })(),
        quotation.totBasisPoints !== null ? `TOT: ${percent(quotation.totBasisPoints)}` : null,
        quotation.otherTaxes ? `Other taxes: ${quotation.otherTaxes}` : null,
      ]
        .filter(Boolean)
        .join("\n\n");
      const contract = await tx.contract.create({
        data: {
          party: "SUPPLIER",
          name: `${entry.property.name} — ${quotation.name}`,
          eventId: entry.eventId,
          propertyId: entry.propertyId,
          totalCents: quotation.totalCents,
          currency: quotation.currency,
          documentUrl: quotation.documentUrl,
          // Tied to the client's request it was quoted for (doc §4.11): client and hotel contracts side by side.
          salesRequestId: quotation.salesRequestId,
          notes: terms,
          ownerId: entry.accountManagerId ?? ctx.session.user.id,
        },
        select: { id: true, name: true, eventId: true },
      });
      // Its payments and cut-offs become the contract's own (doc §7.1): a payment on signature falls due today.
      await tx.contractPayment.createMany({
        data: quotation.payments.map((payment, index) => ({
          contractId: contract.id,
          description: payment.onSignature ? "On signature" : `Payment ${index + 1}`,
          dueOn: payment.onSignature ? today() : payment.dueOn!,
          percentBasisPoints: payment.percentBasisPoints,
        })),
      });
      await tx.contractCancellation.createMany({
        data: quotation.cancellations.map((cut) => ({
          contractId: contract.id,
          kind: cut.kind,
          cutoffOn: cut.cutoffOn,
          percentBasisPoints: cut.percentBasisPoints,
          feeBasisPoints: cut.feeBasisPoints,
          remarks: cut.remarks,
        })),
      });
      await tx.quotation.update({ where: { id: quotation.id }, data: { status: "ACCEPTED", contractId: contract.id } });
      await logAudit(tx, { actorId: ctx.session.user.id, entity: "Contract", entityId: contract.id, summary: `Contract made from the quotation "${quotation.name}"` });
      await logAudit(tx, {
        actorId: ctx.session.user.id,
        entity: "ScoutingEntry",
        entityId: quotation.scoutingEntryId,
        summary: `Quotation accepted and made into a contract: ${quotation.name}`,
      });
      return contract;
    }),
  ),
});
