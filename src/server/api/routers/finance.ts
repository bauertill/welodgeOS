import { CancellationKind, ContractParty, PaymentStatus, type Prisma } from "generated/prisma";
import { TRPCError } from "@trpc/server";
import { z } from "zod";

import { addDays, parseDay, today } from "~/lib/dates";
import { formatDate, formatMoney } from "~/lib/format";
import { cancellationKindLabels, isSettled, missingTerms, paymentAmount, paymentStatusLabels, percent } from "~/lib/finance";
import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";
import { moveStage } from "~/server/api/routers/sales";
import { diffFields, logAudit } from "~/server/audit";

/**
 * Contracts, their payments and their cancellation deadlines (doc §7.1): what
 * we signed with each supplier and each client, what falls due when, and what
 * may be given back by when. Every amount is a share of the contract's total,
 * worked out when read.
 */

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Give the date");
const optionalDay = z.string().regex(/^(\d{4}-\d{2}-\d{2})?$/, "That date does not look right");
const text = z.string().max(5000);
const link = z
  .string()
  .trim()
  .max(2000)
  .refine((value) => value === "" || /^https?:\/\//.test(value), "Paste the whole link, starting with https://");
const blank = (value: string | undefined) => (value?.trim() ? value.trim() : null);
const toDay = (value: string | undefined) => (value ? parseDay(value) : null);
const share = z.number().int().min(0).max(10_000).nullable();

const person = { select: { id: true, name: true, email: true, image: true } } as const;
const contractInclude = {
  event: { select: { id: true, name: true } },
  property: { select: { id: true, name: true } },
  client: { select: { id: true, name: true, shortName: true } },
  salesRequest: { select: { id: true, stage: true } },
  owner: person,
  _count: { select: { payments: true, cancellations: true, acquisitionNights: true, salesNights: true } },
} satisfies Prisma.ContractInclude;

/** Who the contract is with, as a person reads it. */
const counterparty = (contract: { property: { name: string } | null; client: { name: string } | null }) =>
  contract.property?.name ?? contract.client?.name ?? "—";

const contractInput = z.object({
  name: z.string().trim().min(1, "Give the contract a name").max(300),
  documentUrl: link.optional(),
  signedOn: optionalDay.optional(),
  totalCents: z.number().int().min(0).nullable().optional(),
  currency: z.string().length(3).optional(),
  notes: text.optional(),
  ownerId: z.string().nullable().optional(),
  noCancellationTerms: z.boolean().optional(),
});

const paymentInput = z.object({
  description: z.string().trim().min(1, "Say what the payment is, like 1st deposit").max(500),
  dueOn: day,
  percentBasisPoints: share,
  amountCents: z.number().int().min(0).nullable(),
  status: z.nativeEnum(PaymentStatus),
  paidOn: optionalDay,
  invoiceUrl: link,
  proofUrl: link,
  beneficiary: z.string().max(300),
});

const cancellationInput = z.object({
  kind: z.nativeEnum(CancellationKind),
  cutoffOn: day,
  percentBasisPoints: share,
  appliesTo: z.string().max(500),
  roomType: z.string().max(200),
  feeBasisPoints: share,
  remarks: text,
});

/** One line per field of a payment or deadline that changed, for the contract's history. */
function describe(before: Record<string, unknown> | null, after: Record<string, unknown>, labels: Record<string, string>) {
  if (!before) return null;
  return diffFields(before, after, Object.entries(labels).map(([key, label]) => ({ key, label })));
}

const readablePayment = (payment: Prisma.ContractPaymentGetPayload<object>) => ({
  description: payment.description,
  dueOn: formatDate(payment.dueOn),
  share: percent(payment.percentBasisPoints),
  amount: payment.amountCents === null ? null : String(payment.amountCents / 100),
  status: paymentStatusLabels[payment.status],
  paidOn: payment.paidOn ? formatDate(payment.paidOn) : null,
});

export const financeRouter = createTRPCRouter({
  /** Every contract, for an event or all of them, each with what it still lacks. */
  contracts: protectedProcedure
    .input(
      z.object({
        eventId: z.string().optional(),
        party: z.nativeEnum(ContractParty).optional(),
        salesRequestId: z.string().optional(),
        propertyId: z.string().optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const contracts = await ctx.db.contract.findMany({
        where: { eventId: input.eventId, party: input.party, salesRequestId: input.salesRequestId, propertyId: input.propertyId },
        orderBy: [{ event: { startDate: "asc" } }, { name: "asc" }],
        include: contractInclude,
      });
      return contracts.map((contract) => ({ ...contract, missing: missingTerms(contract) }));
    }),

  /** One contract in full: its terms, and what is due and open. */
  contract: protectedProcedure.input(z.object({ id: z.string() })).query(async ({ ctx, input }) => {
    const contract = await ctx.db.contract.findUnique({
      where: { id: input.id },
      include: {
        ...contractInclude,
        payments: { orderBy: [{ dueOn: "asc" }, { createdAt: "asc" }] },
        cancellations: { orderBy: [{ cutoffOn: "asc" }, { createdAt: "asc" }] },
      },
    });
    if (!contract) return null;
    return {
      ...contract,
      missing: missingTerms(contract),
      payments: contract.payments.map((payment) => ({ ...payment, amount: paymentAmount(payment, contract) })),
    };
  }),

  /** Who a new contract can be with on this event: the hotels on its list, or any client. */
  counterparties: protectedProcedure
    .input(z.object({ eventId: z.string(), party: z.nativeEnum(ContractParty) }))
    .query(async ({ ctx, input }) => {
      if (input.party === "CLIENT") {
        const clients = await ctx.db.client.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true, shortName: true } });
        return clients.map((client) => ({ id: client.id, label: client.name, detail: client.shortName }));
      }
      const entries = await ctx.db.scoutingEntry.findMany({
        where: { eventId: input.eventId },
        select: { property: { select: { id: true, name: true } } },
        orderBy: { property: { name: "asc" } },
      });
      return entries.map((entry) => ({ id: entry.property.id, label: entry.property.name, detail: null }));
    }),

  createContract: protectedProcedure
    .input(
      contractInput.extend({
        party: z.nativeEnum(ContractParty),
        eventId: z.string(),
        propertyId: z.string().optional(),
        clientId: z.string().optional(),
        salesRequestId: z.string().optional(),
        /** Registered on the way to marking its sales request Signed: the request moves too. */
        markRequestSigned: z.boolean().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      if (input.party === "SUPPLIER" && !input.propertyId) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Choose the hotel this contract is with." });
      }
      if (input.party === "CLIENT" && !input.clientId) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Choose the client this contract is with." });
      }
      if (input.salesRequestId) {
        const request = await ctx.db.salesRequest.findUnique({ where: { id: input.salesRequestId }, select: { clientId: true } });
        if (request?.clientId !== input.clientId) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "That sales request is not this client's." });
        }
      }
      if (input.markRequestSigned && (input.party !== "CLIENT" || !input.salesRequestId)) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Only a client contract from a sales request can mark it signed." });
      }
      return ctx.db.$transaction(async (tx) => {
      const contract = await tx.contract.create({
        data: {
          party: input.party,
          name: input.name,
          eventId: input.eventId,
          propertyId: input.party === "SUPPLIER" ? input.propertyId : null,
          clientId: input.party === "CLIENT" ? input.clientId : null,
          salesRequestId: input.party === "CLIENT" ? (input.salesRequestId ?? null) : null,
          documentUrl: blank(input.documentUrl),
          signedOn: toDay(input.signedOn),
          totalCents: input.totalCents ?? null,
          currency: input.totalCents != null ? (input.currency ?? "USD") : null,
          notes: blank(input.notes),
          ownerId: input.ownerId ?? ctx.session.user.id,
          noCancellationTerms: input.noCancellationTerms ?? false,
        },
      });
      await logAudit(tx, { actorId: ctx.session.user.id, entity: "Contract", entityId: contract.id, summary: "Contract added" });
      if (input.markRequestSigned) await moveStage(tx, ctx.session.user.id, input.salesRequestId!, "SIGNED");
      return contract;
      });
    }),

  /** Change a contract's own details; its payments are changed one by one. */
  updateContract: protectedProcedure
    .input(contractInput.partial().extend({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const before = await ctx.db.contract.findUniqueOrThrow({ where: { id: input.id }, include: { owner: person } });
      const data: Prisma.ContractUncheckedUpdateInput = {
        ...(input.name !== undefined && { name: input.name }),
        ...(input.documentUrl !== undefined && { documentUrl: blank(input.documentUrl) }),
        ...(input.signedOn !== undefined && { signedOn: toDay(input.signedOn) }),
        ...(input.totalCents !== undefined && {
          totalCents: input.totalCents,
          currency: input.totalCents === null ? null : (input.currency ?? before.currency ?? "USD"),
        }),
        ...(input.notes !== undefined && { notes: blank(input.notes) }),
        ...(input.ownerId !== undefined && { ownerId: input.ownerId }),
        ...(input.noCancellationTerms !== undefined && { noCancellationTerms: input.noCancellationTerms }),
      };
      const after = await ctx.db.contract.update({ where: { id: input.id }, data, include: { owner: person } });
      const readable = (c: typeof after) => ({
        name: c.name,
        documentUrl: c.documentUrl,
        signedOn: c.signedOn ? formatDate(c.signedOn) : null,
        total: c.totalCents !== null && c.currency ? formatMoney(c.totalCents, c.currency) : null,
        notes: c.notes,
        owner: c.owner?.name ?? c.owner?.email ?? null,
        noCancellationTerms: c.noCancellationTerms ? "No cancellation terms" : null,
      });
      const changes = describe(readable(before), readable(after), {
        name: "Name",
        documentUrl: "Signed PDF",
        signedOn: "Signed on",
        total: "Total",
        notes: "Notes",
        owner: "Account manager",
        noCancellationTerms: "Cancellation terms",
      });
      if (changes) {
        await logAudit(ctx.db, { actorId: ctx.session.user.id, entity: "Contract", entityId: input.id, summary: "Contract updated", changes });
      }
      return after;
    }),

  /** Add a payment to a contract, or change one. */
  savePayment: protectedProcedure
    .input(z.object({ contractId: z.string(), id: z.string().optional(), payment: paymentInput }))
    .mutation(async ({ ctx, input }) => {
      const { payment } = input;
      if (payment.percentBasisPoints === null && payment.amountCents === null) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Give the payment's share of the total, like 20%, or a set amount." });
      }
      const data = {
        description: payment.description,
        dueOn: parseDay(payment.dueOn),
        // A share and a set amount never both: the share wins, as the total may change.
        percentBasisPoints: payment.percentBasisPoints,
        amountCents: payment.percentBasisPoints !== null ? null : payment.amountCents,
        status: payment.status,
        paidOn: payment.status === "PAID" || payment.status === "REFUND" ? (toDay(payment.paidOn) ?? today()) : null,
        invoiceUrl: blank(payment.invoiceUrl),
        proofUrl: blank(payment.proofUrl),
        beneficiary: blank(payment.beneficiary),
      };
      const before = input.id ? await ctx.db.contractPayment.findUniqueOrThrow({ where: { id: input.id } }) : null;
      if (before && before.contractId !== input.contractId) throw new TRPCError({ code: "BAD_REQUEST", message: "That payment is on another contract." });
      const saved = before
        ? await ctx.db.contractPayment.update({ where: { id: before.id }, data })
        : await ctx.db.contractPayment.create({ data: { ...data, contractId: input.contractId } });
      await logAudit(ctx.db, {
        actorId: ctx.session.user.id,
        entity: "Contract",
        entityId: input.contractId,
        summary: `${before ? "Payment updated" : "Payment added"}: ${saved.description}`,
        changes: describe(before && readablePayment(before), readablePayment(saved), {
          description: "Payment",
          dueOn: "Due",
          share: "Share",
          amount: "Amount",
          status: "Status",
          paidOn: "Paid on",
        }),
      });
      return saved;
    }),

  /** Move a payment on — invoiced, paid — straight from a list. */
  setPaymentStatus: protectedProcedure
    .input(z.object({ id: z.string(), status: z.nativeEnum(PaymentStatus) }))
    .mutation(async ({ ctx, input }) => {
      const before = await ctx.db.contractPayment.findUniqueOrThrow({ where: { id: input.id } });
      const saved = await ctx.db.contractPayment.update({
        where: { id: input.id },
        data: { status: input.status, paidOn: isSettled(input.status) ? (before.paidOn ?? today()) : null },
      });
      await logAudit(ctx.db, {
        actorId: ctx.session.user.id,
        entity: "Contract",
        entityId: before.contractId,
        summary: `Payment ${paymentStatusLabels[input.status].toLowerCase()}: ${before.description}`,
        changes: `Status: ${paymentStatusLabels[before.status]} → ${paymentStatusLabels[input.status]}`,
      });
      return saved;
    }),

  removePayment: protectedProcedure.input(z.object({ id: z.string() })).mutation(async ({ ctx, input }) => {
    const removed = await ctx.db.contractPayment.delete({ where: { id: input.id } });
    await logAudit(ctx.db, {
      actorId: ctx.session.user.id,
      entity: "Contract",
      entityId: removed.contractId,
      summary: `Payment removed: ${removed.description}`,
      changes: `Was due ${formatDate(removed.dueOn)}${removed.percentBasisPoints !== null ? `, ${percent(removed.percentBasisPoints)}` : ""}`,
    });
  }),

  /** Add a cancellation deadline to a contract, or change one. */
  saveCancellation: protectedProcedure
    .input(z.object({ contractId: z.string(), id: z.string().optional(), cancellation: cancellationInput }))
    .mutation(async ({ ctx, input }) => {
      const { cancellation } = input;
      const data = {
        kind: cancellation.kind,
        cutoffOn: parseDay(cancellation.cutoffOn),
        percentBasisPoints: cancellation.percentBasisPoints,
        appliesTo: blank(cancellation.appliesTo),
        roomType: blank(cancellation.roomType),
        feeBasisPoints: cancellation.feeBasisPoints,
        remarks: blank(cancellation.remarks),
      };
      const before = input.id ? await ctx.db.contractCancellation.findUniqueOrThrow({ where: { id: input.id } }) : null;
      if (before && before.contractId !== input.contractId) throw new TRPCError({ code: "BAD_REQUEST", message: "That deadline is on another contract." });
      const saved = before
        ? await ctx.db.contractCancellation.update({ where: { id: before.id }, data })
        : await ctx.db.contractCancellation.create({ data: { ...data, contractId: input.contractId } });
      const readable = (c: typeof saved) => ({
        kind: cancellationKindLabels[c.kind],
        cutoffOn: formatDate(c.cutoffOn),
        share: percent(c.percentBasisPoints),
        appliesTo: c.appliesTo,
        roomType: c.roomType,
        fee: percent(c.feeBasisPoints),
        remarks: c.remarks,
      });
      await logAudit(ctx.db, {
        actorId: ctx.session.user.id,
        entity: "Contract",
        entityId: input.contractId,
        summary: `${before ? "Cancellation deadline updated" : "Cancellation deadline added"}: ${cancellationKindLabels[saved.kind]}, ${formatDate(saved.cutoffOn)}`,
        changes: describe(before && readable(before), readable(saved), {
          kind: "Kind",
          cutoffOn: "Cut-off",
          share: "Share",
          appliesTo: "Applies to",
          roomType: "Room type",
          fee: "Fee",
          remarks: "Remarks",
        }),
      });
      return saved;
    }),

  /** Say a deadline has been dealt with — or not, after all. Nothing else changes (§2.4). */
  setHandled: protectedProcedure
    .input(z.object({ id: z.string(), handled: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      const saved = await ctx.db.contractCancellation.update({
        where: { id: input.id },
        data: { handledOn: input.handled ? today() : null },
      });
      await logAudit(ctx.db, {
        actorId: ctx.session.user.id,
        entity: "Contract",
        entityId: saved.contractId,
        summary: `Cancellation deadline ${input.handled ? "dealt with" : "reopened"}: ${cancellationKindLabels[saved.kind]}, ${formatDate(saved.cutoffOn)}`,
      });
      return saved;
    }),

  removeCancellation: protectedProcedure.input(z.object({ id: z.string() })).mutation(async ({ ctx, input }) => {
    const removed = await ctx.db.contractCancellation.delete({ where: { id: input.id } });
    await logAudit(ctx.db, {
      actorId: ctx.session.user.id,
      entity: "Contract",
      entityId: removed.contractId,
      summary: `Cancellation deadline removed: ${cancellationKindLabels[removed.kind]}, ${formatDate(removed.cutoffOn)}`,
    });
  }),

  /**
   * The Payments page: what we owe suppliers, or what clients owe us, soonest
   * first — open ones by default.
   */
  payments: protectedProcedure
    .input(
      z.object({
        party: z.nativeEnum(ContractParty),
        show: z.enum(["open", "settled", "all"]).default("open"),
        eventId: z.string().optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const payments = await ctx.db.contractPayment.findMany({
        where: {
          contract: { party: input.party, eventId: input.eventId },
          ...(input.show === "open" && { status: { notIn: ["PAID", "REFUND"] } }),
          ...(input.show === "settled" && { status: { in: ["PAID", "REFUND"] } }),
        },
        orderBy: [{ dueOn: "asc" }, { createdAt: "asc" }],
        take: 1000,
        include: {
          contract: {
            select: {
              id: true,
              name: true,
              totalCents: true,
              currency: true,
              event: { select: { id: true, name: true } },
              property: { select: { id: true, name: true } },
              client: { select: { id: true, name: true } },
            },
          },
        },
      });
      return payments.map((payment) => ({
        ...payment,
        amount: paymentAmount(payment, payment.contract),
        counterparty: counterparty(payment.contract),
      }));
    }),

  /** The Cancellations page: supplier or client cut-offs, soonest first. */
  cancellations: protectedProcedure
    .input(
      z.object({
        party: z.nativeEnum(ContractParty),
        show: z.enum(["open", "handled", "all"]).default("open"),
        eventId: z.string().optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const rows = await ctx.db.contractCancellation.findMany({
        where: {
          contract: { party: input.party, eventId: input.eventId },
          ...(input.show === "open" && { handledOn: null }),
          ...(input.show === "handled" && { handledOn: { not: null } }),
        },
        orderBy: [{ cutoffOn: "asc" }, { createdAt: "asc" }],
        take: 1000,
        include: {
          contract: {
            select: {
              id: true,
              name: true,
              event: { select: { id: true, name: true } },
              property: { select: { id: true, name: true } },
              client: { select: { id: true, name: true } },
            },
          },
        },
      });
      return rows.map((row) => ({ ...row, counterparty: counterparty(row.contract) }));
    }),

  /** For the menu's Finances panel: what is due or overdue, and contracts missing their terms. */
  summary: protectedProcedure.query(async ({ ctx }) => {
    const soon = addDays(today(), 7);
    const [supplierDue, clientDue, cutoffs, contracts] = await Promise.all([
      ctx.db.contractPayment.count({ where: { contract: { party: "SUPPLIER" }, status: { notIn: ["PAID", "REFUND"] }, dueOn: { lte: soon } } }),
      ctx.db.contractPayment.count({ where: { contract: { party: "CLIENT" }, status: { notIn: ["PAID", "REFUND"] }, dueOn: { lte: soon } } }),
      ctx.db.contractCancellation.count({ where: { handledOn: null, cutoffOn: { lte: addDays(today(), 30) } } }),
      ctx.db.contract.findMany({ select: { documentUrl: true, totalCents: true, noCancellationTerms: true, _count: { select: { payments: true, cancellations: true } } } }),
    ]);
    return {
      supplierDue,
      clientDue,
      cutoffs,
      incomplete: contracts.filter((contract) => missingTerms(contract).length > 0).length,
    };
  }),
});
