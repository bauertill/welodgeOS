import { ContractorKind } from "generated/prisma";
import { TRPCError } from "@trpc/server";
import { z } from "zod";

import { contractingFields } from "~/lib/contracting";
import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";
import { logAudit } from "~/server/audit";

/**
 * Contractors (doc §3.11, the owner 2026-11-19: "we are also using other
 * contractors like furniture companies, cleaning companies"): the companies we
 * use besides the hotels — each with its contacts and contracting details, the
 * events it works on, the properties it serves, and, elsewhere, its contracts
 * and payments (§7.1), tasks (§2.8) and updates (§2.6).
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
const nameInput = z.string().trim().min(1, "A contractor needs a name.").max(200);

async function refuseDuplicate(db: { contractor: { findFirst: (args: object) => Promise<{ name: string } | null> } }, name: string, id?: string) {
  const duplicate = await db.contractor.findFirst({ where: { ...(id && { id: { not: id } }), name: { equals: name, mode: "insensitive" } } });
  if (duplicate) throw new TRPCError({ code: "BAD_REQUEST", message: `"${duplicate.name}" is already a contractor.` });
}

export const contractorRouter = createTRPCRouter({
  /** Every contractor — or one event's — with what it does, its events and how much rests on it. */
  list: protectedProcedure.input(z.object({ eventId: z.string().optional() }).default({})).query(({ ctx, input }) =>
    ctx.db.contractor.findMany({
      where: input.eventId ? { events: { some: { eventId: input.eventId } } } : undefined,
      orderBy: { name: "asc" },
      include: {
        events: { include: { event: { select: { id: true, name: true } } }, orderBy: { event: { startDate: "asc" } } },
        contacts: { orderBy: { name: "asc" }, take: 1 },
        _count: { select: { properties: true, contracts: true, tasks: true } },
      },
    }),
  ),

  byId: protectedProcedure.input(z.object({ id: z.string() })).query(({ ctx, input }) =>
    ctx.db.contractor.findUnique({
      where: { id: input.id },
      include: {
        contacts: { orderBy: { name: "asc" } },
        events: { include: { event: { select: { id: true, name: true } } }, orderBy: { event: { startDate: "asc" } } },
        properties: { include: { property: { select: { id: true, name: true, city: true, type: true } } }, orderBy: { property: { name: "asc" } } },
        _count: { select: { contracts: true } },
      },
    }),
  ),

  /** The contractors serving one property, for its page. */
  forProperty: protectedProcedure.input(z.object({ propertyId: z.string() })).query(({ ctx, input }) =>
    ctx.db.contractorProperty.findMany({
      where: { propertyId: input.propertyId },
      include: { contractor: { select: { id: true, name: true, kind: true, service: true, phone: true, email: true } } },
      orderBy: { contractor: { name: "asc" } },
    }),
  ),

  create: protectedProcedure
    .input(z.object({ name: nameInput, kind: z.nativeEnum(ContractorKind), service: text, eventId: z.string().optional() }))
    .mutation(async ({ ctx, input }) => {
      await refuseDuplicate(ctx.db, input.name);
      const created = await ctx.db.contractor.create({
        data: {
          name: input.name,
          kind: input.kind,
          service: blank(input.service),
          ...(input.eventId && { events: { create: { eventId: input.eventId } } }),
        },
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
      await refuseDuplicate(ctx.db, name, id);
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

  /** Put a contractor on an event, or take it off. */
  setEvent: protectedProcedure
    .input(z.object({ contractorId: z.string(), eventId: z.string(), on: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      const event = await ctx.db.event.findUniqueOrThrow({ where: { id: input.eventId }, select: { name: true } });
      if (input.on) {
        await ctx.db.contractorEvent.upsert({
          where: { contractorId_eventId: { contractorId: input.contractorId, eventId: input.eventId } },
          create: { contractorId: input.contractorId, eventId: input.eventId },
          update: {},
        });
      } else {
        await ctx.db.contractorEvent.deleteMany({ where: { contractorId: input.contractorId, eventId: input.eventId } });
      }
      await logAudit(ctx.db, { actorId: ctx.session.user.id, entity: "Contractor", entityId: input.contractorId, summary: input.on ? `Put on ${event.name}` : `Taken off ${event.name}` });
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

  /** Delete a contractor made by mistake. Refused while it has a contract: those are kept. */
  remove: protectedProcedure.input(z.object({ id: z.string() })).mutation(async ({ ctx, input }) => {
    const contracts = await ctx.db.contract.count({ where: { contractorId: input.id } });
    if (contracts) {
      throw new TRPCError({ code: "BAD_REQUEST", message: `It has ${contracts} contract${contracts === 1 ? "" : "s"}. Delete those first — a contract with payments is kept.` });
    }
    await ctx.db.contractor.delete({ where: { id: input.id } });
    await logAudit(ctx.db, { actorId: ctx.session.user.id, entity: "Contractor", entityId: input.id, summary: "Deleted" });
  }),
});
