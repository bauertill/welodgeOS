import { SalesRequestStage, type Prisma } from "generated/prisma";
import { TRPCError } from "@trpc/server";
import { z } from "zod";

import { parseDay, today } from "~/lib/dates";
import { formatDate, formatMoney } from "~/lib/format";
import {
  contractingFields,
  interestFields,
  isClosed,
  openStages,
  salesStageLabels,
} from "~/lib/sales";
import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";
import { diffFields, logAudit } from "~/server/audit";

/**
 * Sales requests (doc §4.11): a client's interest in accommodation, followed
 * from the first enquiry until it is signed, released, lost, or never
 * answered — with who to chase and when, and the contracting details the
 * lawyers need.
 */

const text = z.string().max(20000).optional();
/** "2028-07-10", or "" to clear it. */
const day = z
  .string()
  .regex(/^(\d{4}-\d{2}-\d{2})?$/, "That date does not look right")
  .optional();

const textKeys = [...interestFields, ...contractingFields].map((field) => field.key);
const textShape = Object.fromEntries(textKeys.map((key) => [key, text])) as Record<
  (typeof textKeys)[number],
  typeof text
>;

const requestInput = z.object({
  ...textShape,
  contactId: z.string().nullable().optional(),
  eventId: z.string().nullable().optional(),
  ownerId: z.string().nullable().optional(),
  followUpOn: day,
  nextStep: text,
  proposalSentOn: day,
  blockedUntil: day,
  valueCents: z.number().int().min(0).nullable().optional(),
  valueCurrency: z.string().length(3).nullable().optional(),
});

const blank = (value: string) => (value.trim() ? value.trim() : null);
const toDate = (value: string) => (value ? parseDay(value) : null);

/** Only what was sent is changed; left out means unchanged. */
function dataFrom(input: z.infer<typeof requestInput>) {
  const data: Prisma.SalesRequestUncheckedUpdateInput = {};
  for (const key of [...textKeys, "nextStep"] as const) {
    const value = input[key];
    if (value !== undefined) data[key] = blank(value);
  }
  for (const key of ["contactId", "eventId", "ownerId"] as const) {
    if (input[key] !== undefined) data[key] = input[key] || null;
  }
  for (const key of ["followUpOn", "proposalSentOn", "blockedUntil"] as const) {
    const value = input[key];
    if (value !== undefined) data[key] = toDate(value);
  }
  if (input.valueCents !== undefined) {
    data.valueCents = input.valueCents;
    // A currency with no amount behind it is noise (§4.5).
    data.valueCurrency = input.valueCents === null ? null : (input.valueCurrency ?? "EUR");
  }
  return data;
}

const person = { select: { id: true, name: true, email: true, image: true } } as const;
const include = {
  client: { select: { id: true, name: true, shortName: true } },
  contact: { select: { id: true, name: true, title: true, email: true } },
  event: { select: { id: true, name: true } },
  owner: person,
} satisfies Prisma.SalesRequestInclude;

type Loaded = Prisma.SalesRequestGetPayload<{ include: typeof include }>;

/** How a request reads in its history — words and dates, not stored codes. */
function readable(request: Loaded) {
  const date = (value: Date | null) => (value ? formatDate(value) : null);
  return {
    ...request,
    stage: salesStageLabels[request.stage],
    contact: request.contact?.name ?? null,
    event: request.event?.name ?? null,
    owner: request.owner?.name ?? request.owner?.email ?? null,
    followUpOn: date(request.followUpOn),
    proposalSentOn: date(request.proposalSentOn),
    blockedUntil: date(request.blockedUntil),
    closedOn: date(request.closedOn),
    value:
      request.valueCents !== null && request.valueCurrency
        ? formatMoney(request.valueCents, request.valueCurrency)
        : null,
  };
}

const historyFields = [
  { key: "stage", label: "Stage" },
  { key: "owner", label: "Account manager" },
  { key: "contact", label: "Contact" },
  { key: "event", label: "Event" },
  { key: "followUpOn", label: "Follow up on" },
  { key: "nextStep", label: "Next step" },
  { key: "proposalSentOn", label: "Proposal sent on" },
  { key: "blockedUntil", label: "Blocked until" },
  { key: "value", label: "Value" },
  ...interestFields.map(({ key, label }) => ({ key, label })),
  ...contractingFields.map(({ key, label }) => ({ key, label })),
] as { key: keyof ReturnType<typeof readable>; label: string }[];

async function checkContact(db: Prisma.TransactionClient, contactId: string | null | undefined, clientId: string) {
  if (!contactId) return;
  const contact = await db.clientContact.findUnique({ where: { id: contactId }, select: { clientId: true } });
  if (contact?.clientId !== clientId) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "That contact does not work at this client." });
  }
}

export const salesRouter = createTRPCRouter({
  /**
   * The Sales requests page (doc §4.11): open ones by default, filtered by
   * event, account manager, and whether a follow-up is due.
   */
  list: protectedProcedure
    .input(
      z.object({
        show: z.enum(["open", "closed", "all"]).default("open"),
        eventId: z.string().optional(),
        ownerId: z.string().optional(),
        dueOnly: z.boolean().default(false),
        q: z.string().max(200).default(""),
      }),
    )
    .query(({ ctx, input }) => {
      const q = input.q.trim();
      const where: Prisma.SalesRequestWhereInput = {
        ...(input.show === "open" && { stage: { in: openStages } }),
        ...(input.show === "closed" && { stage: { notIn: openStages } }),
        ...(input.eventId && { eventId: input.eventId }),
        ...(input.ownerId && { ownerId: input.ownerId }),
        ...(input.dueOnly && { followUpOn: { lte: today() }, stage: { in: openStages } }),
        ...(q && {
          OR: [
            { client: { name: { contains: q, mode: "insensitive" } } },
            { client: { shortName: { contains: q, mode: "insensitive" } } },
            { contact: { name: { contains: q, mode: "insensitive" } } },
            { description: { contains: q, mode: "insensitive" } },
          ],
        }),
      };
      return ctx.db.salesRequest.findMany({
        where,
        orderBy: [{ followUpOn: { sort: "asc", nulls: "last" } }, { createdAt: "desc" }],
        take: 500,
        include,
      });
    }),

  /** A client's requests, for its own page. */
  forClient: protectedProcedure
    .input(z.object({ clientId: z.string() }))
    .query(({ ctx, input }) =>
      ctx.db.salesRequest.findMany({
        where: { clientId: input.clientId },
        orderBy: { createdAt: "desc" },
        include,
      }),
    ),

  byId: protectedProcedure
    .input(z.object({ id: z.string() }))
    .query(({ ctx, input }) =>
      ctx.db.salesRequest.findUnique({
        where: { id: input.id },
        include: {
          ...include,
          client: { select: { id: true, name: true, shortName: true, contacts: { orderBy: { name: "asc" }, select: { id: true, name: true, title: true } } } },
        },
      }),
    ),

  /**
   * Register a client's initial interest. The client is an existing one, or a
   * new one named here — an enquiry often comes from a company we have never
   * dealt with.
   */
  create: protectedProcedure
    .input(
      requestInput.extend({
        clientId: z.string().optional(),
        newClientName: z.string().max(200).optional(),
      }),
    )
    .mutation(({ ctx, input }) =>
      ctx.db.$transaction(async (tx) => {
        const { clientId: chosen, newClientName, ...fields } = input;
        let clientId = chosen;
        if (!clientId) {
          const name = newClientName?.trim();
          if (!name) throw new TRPCError({ code: "BAD_REQUEST", message: "Choose the client, or name a new one." });
          const existing = await tx.client.findFirst({ where: { name: { equals: name, mode: "insensitive" } } });
          if (existing) {
            clientId = existing.id;
          } else {
            const created = await tx.client.create({ data: { name } });
            clientId = created.id;
            await logAudit(tx, { actorId: ctx.session.user.id, entity: "Client", entityId: clientId, summary: "Added" });
          }
        }
        await checkContact(tx, fields.contactId, clientId);
        const request = await tx.salesRequest.create({
          data: { ...(dataFrom(fields) as Prisma.SalesRequestUncheckedCreateInput), clientId },
          include,
        });
        await logAudit(tx, {
          actorId: ctx.session.user.id,
          entity: "SalesRequest",
          entityId: request.id,
          summary: "Initial interest registered",
        });
        await logAudit(tx, {
          actorId: ctx.session.user.id,
          entity: "Client",
          entityId: clientId,
          summary: `Sales request added${request.event ? ` for ${request.event.name}` : ""}`,
        });
        return request;
      }),
    ),

  /** Change any part of a request; the history records what changed. */
  update: protectedProcedure
    .input(requestInput.extend({ id: z.string() }))
    .mutation(({ ctx, input }) =>
      ctx.db.$transaction(async (tx) => {
        const { id, ...fields } = input;
        const before = await tx.salesRequest.findUniqueOrThrow({ where: { id }, include });
        await checkContact(tx, fields.contactId, before.clientId);
        const after = await tx.salesRequest.update({ where: { id }, data: dataFrom(fields), include });
        const changes = diffFields(readable(before), readable(after), historyFields);
        if (changes) {
          await logAudit(tx, { actorId: ctx.session.user.id, entity: "SalesRequest", entityId: id, summary: "Updated", changes });
        }
        return after;
      }),
    ),

  /**
   * Move a request to another stage. Moving to *Proposal sent* dates the
   * proposal today unless a date is already there; closing it dates the close,
   * and reopening clears that — a request is closed only while its stage says so.
   */
  setStage: protectedProcedure
    .input(z.object({ id: z.string(), stage: z.nativeEnum(SalesRequestStage) }))
    .mutation(({ ctx, input }) =>
      ctx.db.$transaction(async (tx) => {
        const before = await tx.salesRequest.findUniqueOrThrow({ where: { id: input.id }, include });
        if (before.stage === input.stage) return before;
        const closing = isClosed(input.stage);
        const after = await tx.salesRequest.update({
          where: { id: input.id },
          data: {
            stage: input.stage,
            closedOn: closing ? (before.closedOn && isClosed(before.stage) ? before.closedOn : today()) : null,
            ...(input.stage === "PROPOSAL_SENT" && !before.proposalSentOn && { proposalSentOn: today() }),
          },
          include,
        });
        await logAudit(tx, {
          actorId: ctx.session.user.id,
          entity: "SalesRequest",
          entityId: input.id,
          summary: `Stage: ${salesStageLabels[before.stage]} → ${salesStageLabels[input.stage]}`,
        });
        return after;
      }),
    ),
});

