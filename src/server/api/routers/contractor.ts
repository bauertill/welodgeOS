import { ContractorKind, QuotationStatus } from "generated/prisma";
import { TRPCError } from "@trpc/server";
import { z } from "zod";

import { contractingFields } from "~/lib/contracting";
import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";
import { logAudit } from "~/server/audit";

/**
 * Contractors (doc §3.11, the owner 2026-11-19: "we are also using other
 * contractors like furniture companies, cleaning companies … they form part of
 * an event and don't cross from event to event"): the companies working on one
 * event besides the hotels — each with its contacts and contracting details,
 * the properties it serves, and, elsewhere, its contracts and payments (§7.1),
 * tasks (§2.8) and updates (§2.6).
 */

const text = z.string().max(2000).optional();
const contracting = z.object(
  Object.fromEntries(contractingFields.map(({ key }) => [key, text])) as Record<(typeof contractingFields)[number]["key"], typeof text>,
);
const contactInput = z.object({
  name: z.string().trim().min(1, "A contact needs a name."),
  role: z.string().optional(),
  email: z.string().email("That email address does not look right.").optional().or(z.literal("")),
  phone: z.string().optional(),
});
const blank = (value: string | null | undefined) => (value?.trim() ? value.trim() : null);
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "A date as YYYY-MM-DD");
const toDay = (value: string | null | undefined) => (value ? new Date(`${value}T00:00:00Z`) : null);
const link = z.string().trim().max(2000);
const person = { select: { id: true, name: true, email: true } } as const;
const quoteInput = z.object({
  title: z.string().trim().min(1, "Say what the quote is for.").max(300),
  amountCents: z.number().int().min(0).nullable().optional(),
  currency: z.string().length(3).default("USD"),
  receivedOn: day.nullable().optional(),
  validUntil: day.nullable().optional(),
  documentUrl: link.optional(),
  notes: z.string().max(5000).optional(),
});
const nameInput = z.string().trim().min(1, "A contractor needs a name.").max(200);

async function refuseDuplicate(db: { contractor: { findFirst: (args: object) => Promise<{ name: string } | null> } }, eventId: string, name: string, id?: string) {
  const duplicate = await db.contractor.findFirst({ where: { eventId, ...(id && { id: { not: id } }), name: { equals: name, mode: "insensitive" } } });
  if (duplicate) throw new TRPCError({ code: "BAD_REQUEST", message: `"${duplicate.name}" is already a contractor on this event.` });
}

export const contractorRouter = createTRPCRouter({
  /** One event's contractors (or, for the task form's picker, every event's), with what each does and how much rests on it. */
  list: protectedProcedure.input(z.object({ eventId: z.string().optional() }).default({})).query(({ ctx, input }) =>
    ctx.db.contractor.findMany({
      where: input.eventId ? { eventId: input.eventId } : undefined,
      orderBy: { name: "asc" },
      include: {
        event: { select: { id: true, name: true } },
        contacts: { orderBy: { name: "asc" }, take: 1 },
        _count: { select: { properties: true, contracts: true, tasks: { where: { private: false } } } },
      },
    }),
  ),

  byId: protectedProcedure.input(z.object({ id: z.string() })).query(({ ctx, input }) =>
    ctx.db.contractor.findUnique({
      where: { id: input.id },
      include: {
        contacts: { orderBy: { name: "asc" } },
        event: { select: { id: true, name: true } },
        properties: { include: { property: { select: { id: true, name: true, city: true, type: true } } }, orderBy: { property: { name: "asc" } } },
        _count: { select: { contracts: true } },
      },
    }),
  ),

  /** The contractors serving one property, for its page. */
  forProperty: protectedProcedure.input(z.object({ propertyId: z.string() })).query(({ ctx, input }) =>
    ctx.db.contractorProperty.findMany({
      where: { propertyId: input.propertyId },
      include: { contractor: { select: { id: true, name: true, kind: true, service: true, phone: true, email: true, eventId: true, event: { select: { name: true } } } } },
      orderBy: { contractor: { name: "asc" } },
    }),
  ),

  create: protectedProcedure
    .input(z.object({ name: nameInput, kind: z.nativeEnum(ContractorKind), service: text, eventId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      await refuseDuplicate(ctx.db, input.eventId, input.name);
      const created = await ctx.db.contractor.create({
        data: { eventId: input.eventId, name: input.name, kind: input.kind, service: blank(input.service) },
      });
      await logAudit(ctx.db, { actorId: ctx.session.user.id, entity: "Contractor", entityId: created.id, summary: "Added" });
      return created;
    }),

  update: protectedProcedure
    .input(
      contracting.extend({
        id: z.string(),
        name: nameInput,
        kind: z.nativeEnum(ContractorKind),
        service: text,
        website: text,
        email: z.string().email("That email address does not look right.").optional().or(z.literal("")),
        phone: text,
        notes: text,
        contacts: z.array(contactInput).default([]),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { id, contacts, name, kind, service, website, email, phone, notes, ...details } = input;
      const { eventId } = await ctx.db.contractor.findUniqueOrThrow({ where: { id }, select: { eventId: true } });
      await refuseDuplicate(ctx.db, eventId, name, id);
      return ctx.db.$transaction(async (tx) => {
        await tx.contractorContact.deleteMany({ where: { contractorId: id } });
        const updated = await tx.contractor.update({
          where: { id },
          data: {
            name,
            kind,
            service: blank(service),
            website: blank(website),
            email: blank(email),
            phone: blank(phone),
            notes: blank(notes),
            ...Object.fromEntries(Object.entries(details).map(([key, value]) => [key, blank(value)])),
            contacts: {
              create: contacts.map((contact) => ({ name: contact.name.trim(), role: blank(contact.role), email: blank(contact.email), phone: blank(contact.phone) })),
            },
          },
        });
        await logAudit(tx, { actorId: ctx.session.user.id, entity: "Contractor", entityId: id, summary: "Updated" });
        return updated;
      });
    }),

  /** A property it serves, and what it does there — added, changed, or (with on: false) removed. */
  setProperty: protectedProcedure
    .input(z.object({ contractorId: z.string(), propertyId: z.string(), on: z.boolean(), what: z.string().max(500).optional() }))
    .mutation(async ({ ctx, input }) => {
      const property = await ctx.db.property.findUniqueOrThrow({ where: { id: input.propertyId }, select: { name: true } });
      if (input.on) {
        await ctx.db.contractorProperty.upsert({
          where: { contractorId_propertyId: { contractorId: input.contractorId, propertyId: input.propertyId } },
          create: { contractorId: input.contractorId, propertyId: input.propertyId, what: blank(input.what) },
          update: { what: blank(input.what) },
        });
      } else {
        await ctx.db.contractorProperty.deleteMany({ where: { contractorId: input.contractorId, propertyId: input.propertyId } });
      }
      await logAudit(ctx.db, {
        actorId: ctx.session.user.id,
        entity: "Contractor",
        entityId: input.contractorId,
        summary: input.on ? `Serves ${property.name}${input.what?.trim() ? ` — ${input.what.trim()}` : ""}` : `No longer serves ${property.name}`,
      });
    }),

  // --- Quotes and files (doc §3.11, the owner 2026-11-26) ---------------------

  /** Its quotes, newest first, each with the contract made from it. */
  quotes: protectedProcedure.input(z.object({ contractorId: z.string() })).query(({ ctx, input }) =>
    ctx.db.contractorQuote.findMany({
      where: { contractorId: input.contractorId },
      orderBy: [{ receivedOn: { sort: "desc", nulls: "last" } }, { createdAt: "desc" }],
      include: { contract: { select: { id: true, eventId: true, name: true } }, createdBy: person },
    }),
  ),

  addQuote: protectedProcedure.input(quoteInput.extend({ contractorId: z.string() })).mutation(async ({ ctx, input }) => {
    const quote = await ctx.db.contractorQuote.create({
      data: {
        contractorId: input.contractorId,
        title: input.title,
        amountCents: input.amountCents ?? null,
        currency: input.currency,
        receivedOn: toDay(input.receivedOn),
        validUntil: toDay(input.validUntil),
        documentUrl: blank(input.documentUrl),
        notes: blank(input.notes),
        createdById: ctx.session.user.id,
      },
    });
    await logAudit(ctx.db, { actorId: ctx.session.user.id, entity: "Contractor", entityId: input.contractorId, summary: `Quote added: ${quote.title}` });
    return quote;
  }),

  updateQuote: protectedProcedure.input(quoteInput.partial().extend({ id: z.string() })).mutation(async ({ ctx, input }) => {
    const quote = await ctx.db.contractorQuote.update({
      where: { id: input.id },
      data: {
        ...(input.title !== undefined && { title: input.title }),
        ...(input.amountCents !== undefined && { amountCents: input.amountCents }),
        ...(input.currency !== undefined && { currency: input.currency }),
        ...(input.receivedOn !== undefined && { receivedOn: toDay(input.receivedOn) }),
        ...(input.validUntil !== undefined && { validUntil: toDay(input.validUntil) }),
        ...(input.documentUrl !== undefined && { documentUrl: blank(input.documentUrl) }),
        ...(input.notes !== undefined && { notes: blank(input.notes) }),
      },
    });
    await logAudit(ctx.db, { actorId: ctx.session.user.id, entity: "Contractor", entityId: quote.contractorId, summary: `Quote changed: ${quote.title}` });
    return quote;
  }),

  /** Declined, or back to received. Accepting makes the contract (acceptQuote). */
  setQuoteStatus: protectedProcedure.input(z.object({ id: z.string(), status: z.enum([QuotationStatus.RECEIVED, QuotationStatus.DECLINED]) })).mutation(async ({ ctx, input }) => {
    const current = await ctx.db.contractorQuote.findUniqueOrThrow({ where: { id: input.id }, select: { contractId: true } });
    if (current.contractId) throw new TRPCError({ code: "BAD_REQUEST", message: "Its contract is made — change the contract instead." });
    const quote = await ctx.db.contractorQuote.update({ where: { id: input.id }, data: { status: input.status } });
    await logAudit(ctx.db, { actorId: ctx.session.user.id, entity: "Contractor", entityId: quote.contractorId, summary: `Quote ${input.status === "DECLINED" ? "declined" : "back to received"}: ${quote.title}` });
    return quote;
  }),

  /**
   * Accept a quote: it becomes the contractor's supplier contract (§7.1) —
   * named for the quote, with its amount, currency and file — and the
   * contract opens next for its payments and terms.
   */
  acceptQuote: protectedProcedure.input(z.object({ id: z.string() })).mutation(async ({ ctx, input }) => {
    const me = ctx.session.user.id;
    return ctx.db.$transaction(async (tx) => {
      const quote = await tx.contractorQuote.findUniqueOrThrow({ where: { id: input.id }, include: { contractor: { select: { id: true, name: true, eventId: true } } } });
      if (quote.contractId) throw new TRPCError({ code: "BAD_REQUEST", message: "Its contract is already made." });
      const earlier = await tx.contract.findFirst({
        where: { contractorId: quote.contractorId, paymentInstructions: { not: null } },
        orderBy: { createdAt: "desc" },
        select: { paymentInstructions: true },
      });
      const contract = await tx.contract.create({
        data: {
          party: "SUPPLIER",
          name: `${quote.title} — ${quote.contractor.name}`,
          eventId: quote.contractor.eventId,
          contractorId: quote.contractorId,
          documentUrl: quote.documentUrl,
          totalCents: quote.amountCents,
          currency: quote.amountCents != null ? quote.currency : null,
          notes: quote.notes,
          paymentInstructions: earlier?.paymentInstructions ?? null,
          ownerId: me,
        },
      });
      await tx.contractorQuote.update({ where: { id: quote.id }, data: { status: "ACCEPTED", contractId: contract.id } });
      await logAudit(tx, { actorId: me, entity: "Contract", entityId: contract.id, summary: `Contract added, from the quote "${quote.title}"` });
      await logAudit(tx, { actorId: me, entity: "Contractor", entityId: quote.contractorId, summary: `Quote accepted: ${quote.title} — its contract made` });
      return { id: contract.id, eventId: contract.eventId };
    });
  }),

  /** Take off a quote added by mistake. Refused once its contract is made. */
  removeQuote: protectedProcedure.input(z.object({ id: z.string() })).mutation(async ({ ctx, input }) => {
    const current = await ctx.db.contractorQuote.findUniqueOrThrow({ where: { id: input.id }, select: { contractId: true } });
    if (current.contractId) throw new TRPCError({ code: "BAD_REQUEST", message: "Its contract is made — the quote is kept with it." });
    const quote = await ctx.db.contractorQuote.delete({ where: { id: input.id } });
    await logAudit(ctx.db, { actorId: ctx.session.user.id, entity: "Contractor", entityId: quote.contractorId, summary: `Quote removed: ${quote.title}` });
  }),

  /** Its files and links, newest first. */
  files: protectedProcedure.input(z.object({ contractorId: z.string() })).query(({ ctx, input }) =>
    ctx.db.contractorFile.findMany({ where: { contractorId: input.contractorId }, orderBy: { createdAt: "desc" }, include: { addedBy: person } }),
  ),

  /** An uploaded file's address, or a pasted link (https:// added if missing). */
  addFile: protectedProcedure
    .input(z.object({ contractorId: z.string(), url: z.string().trim().min(1, "Upload a file or paste a link.").max(2000), name: z.string().trim().max(300).optional() }))
    .mutation(async ({ ctx, input }) => {
      const url = input.url.startsWith("/") || /^https?:\/\//i.test(input.url) ? input.url : `https://${input.url}`;
      if (!url.startsWith("/")) {
        try {
          new URL(url);
        } catch {
          throw new TRPCError({ code: "BAD_REQUEST", message: "That link does not look right." });
        }
      }
      const last = url.split("?")[0]!.split("/").filter(Boolean).at(-1) ?? "File";
      let name = input.name?.trim() || last;
      try {
        if (!input.name?.trim()) name = decodeURIComponent(last);
      } catch {
        // Kept as it is.
      }
      const file = await ctx.db.contractorFile.create({ data: { contractorId: input.contractorId, url, name, addedById: ctx.session.user.id } });
      await logAudit(ctx.db, { actorId: ctx.session.user.id, entity: "Contractor", entityId: input.contractorId, summary: `File added: ${name}` });
      return file;
    }),

  removeFile: protectedProcedure.input(z.object({ id: z.string() })).mutation(async ({ ctx, input }) => {
    const file = await ctx.db.contractorFile.delete({ where: { id: input.id } });
    await logAudit(ctx.db, { actorId: ctx.session.user.id, entity: "Contractor", entityId: file.contractorId, summary: `File removed: ${file.name}` });
  }),

  /** Delete a contractor made by mistake. Refused while it has a contract: those are kept. */
  remove: protectedProcedure.input(z.object({ id: z.string() })).mutation(async ({ ctx, input }) => {
    const { eventId } = await ctx.db.contractor.findUniqueOrThrow({ where: { id: input.id }, select: { eventId: true } });
    const contracts = await ctx.db.contract.count({ where: { contractorId: input.id } });
    if (contracts) {
      throw new TRPCError({ code: "BAD_REQUEST", message: `It has ${contracts} contract${contracts === 1 ? "" : "s"}. Delete those first — a contract with payments is kept.` });
    }
    await ctx.db.contractor.delete({ where: { id: input.id } });
    await logAudit(ctx.db, { actorId: ctx.session.user.id, entity: "Contractor", entityId: input.id, summary: "Deleted" });
    return { eventId };
  }),
});
