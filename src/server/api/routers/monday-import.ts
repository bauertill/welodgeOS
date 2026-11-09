import { TRPCError } from "@trpc/server";
import type { Prisma } from "generated/prisma";
import { z } from "zod";

import { parseDay } from "~/lib/dates";
import { logAudit } from "~/server/audit";
import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";

/**
 * Bringing monday.com's sales requests in (doc §4.11, 2026-11-09): a file of
 * deals, read from monday's *Sales Requests* board, previewed — which client,
 * which event, who manages it, which contacts — then imported, each deal its
 * own sales request at Initial interest. A deal already imported is never
 * imported again; nothing in the system is changed but what is added.
 */

const text = z.string().max(20_000).optional();
const contactInput = z.object({
  mondayId: z.string().max(40),
  name: z.string().trim().min(1).max(200),
  title: z.string().max(300).optional(),
  email: z.string().max(320).optional(),
  mobile: z.string().max(100).optional(),
  phone: z.string().max(100).optional(),
});
const dealInput = z.object({
  mondayId: z.string().max(40),
  name: z.string().trim().min(1).max(300),
  event: z.string().max(100).nullable().optional(),
  owners: z.array(z.string().max(200)).max(10).default([]),
  createdOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  description: text,
  location: text,
  rooms: text,
  period: text,
  budget: text,
  prePost: text,
  rateIncludes: text,
  extraServices: text,
  contacts: z.array(contactInput).max(30).default([]),
});
export const mondayFile = z.object({ deals: z.array(dealInput).min(1).max(500) });
type Deal = z.infer<typeof dealInput>;

const importInput = z.object({
  deals: z.array(dealInput).min(1).max(500),
  /** monday's event label → one of our events, or null for none. */
  events: z.record(z.string(), z.string().nullable()),
});

const same = (a: string | null | undefined, b: string | null | undefined) => (a ?? "").trim().toLowerCase() === (b ?? "").trim().toLowerCase() && Boolean(a?.trim());
const blank = (value: string | undefined) => (value?.trim() ? value.trim() : null);

type Person = { id: string; name: string | null; email: string | null };
/**
 * Who in the team an owner on monday is: by email ("ami@welodge.net"), by
 * name ("Elena Condini Mosna"), or by the start of an email ("Volki" →
 * volki@welodge.net), or a first name. The first owner who is found manages it.
 */
function teamMember(owners: string[], people: Person[]) {
  for (const owner of owners) {
    const found =
      people.find((p) => same(p.email, owner)) ??
      people.find((p) => same(p.name, owner)) ??
      people.find((p) => same(p.email?.split("@")[0], owner)) ??
      people.find((p) => same(p.name?.split(" ")[0], owner));
    if (found) return found;
  }
  return null;
}

/** What each deal would become: its client, event, manager and contacts, and anything to look at first. */
async function plan(db: Prisma.TransactionClient, deals: Deal[], events: Record<string, string | null>) {
  const [clients, people, ourEvents, imported] = await Promise.all([
    db.client.findMany({ select: { id: true, name: true, shortName: true, contacts: { select: { id: true, name: true, email: true } } } }),
    db.user.findMany({ select: { id: true, name: true, email: true } }),
    db.event.findMany({ select: { id: true, name: true } }),
    db.salesRequest.findMany({ where: { mondayItemId: { in: deals.map((deal) => deal.mondayId) } }, select: { mondayItemId: true, id: true } }),
  ]);
  const already = new Map(imported.map((request) => [request.mondayItemId!, request.id]));
  const existingRequests = await db.salesRequest.findMany({ select: { clientId: true, eventId: true } });
  return deals.map((deal) => {
    const client = clients.find((c) => same(c.name, deal.name) || same(c.shortName, deal.name)) ?? null;
    const eventId = deal.event ? (events[deal.event] ?? null) : null;
    const event = ourEvents.find((e) => e.id === eventId) ?? null;
    const owner = teamMember(deal.owners, people);
    const contacts = deal.contacts.map((contact) => {
      const known = client?.contacts.find((c) => (contact.email && same(c.email, contact.email)) || same(c.name, contact.name)) ?? null;
      return { ...contact, existingId: known?.id ?? null };
    });
    const notes: string[] = [];
    if (deal.event && !event) notes.push(`No event chosen for monday's "${deal.event}" — it comes in with no event`);
    if (deal.owners.length && !owner) notes.push(`Account manager "${deal.owners.join(", ")}" not found in the team`);
    if (client && eventId && existingRequests.some((r) => r.clientId === client.id && r.eventId === eventId)) {
      notes.push(`${client.name} already has a sales request for ${event!.name}`);
    }
    return {
      mondayId: deal.mondayId,
      name: deal.name,
      mondayEvent: deal.event ?? null,
      client: client ? { id: client.id, name: client.name, isNew: false } : { id: null, name: deal.name, isNew: true },
      event,
      owner: owner ? { id: owner.id, name: owner.name ?? owner.email } : null,
      contacts,
      alreadyImported: already.get(deal.mondayId) ?? null,
      notes,
    };
  });
}

export const mondayImportRouter = createTRPCRouter({
  /** The events to match monday's to. */
  events: protectedProcedure.query(({ ctx }) => ctx.db.event.findMany({ orderBy: { startDate: "asc" }, select: { id: true, name: true } })),

  /** What importing would do, deal by deal — nothing is written. (A mutation only so the deals travel in the body.) */
  preview: protectedProcedure.input(importInput).mutation(({ ctx, input }) => plan(ctx.db, input.deals, input.events)),

  /**
   * Import the deals, each its own sales request at Initial interest — client
   * found or added, contacts found on the client or added to it, its words in
   * the request's own fields, the monday deal's date as when it was registered.
   * Deals already imported are skipped.
   */
  run: protectedProcedure.input(importInput.extend({ only: z.array(z.string()).max(500) })).mutation(async ({ ctx, input }) => {
    const chosen = input.deals.filter((deal) => input.only.includes(deal.mondayId));
    if (!chosen.length) throw new TRPCError({ code: "BAD_REQUEST", message: "Tick at least one deal to import." });
    const actorId = ctx.session.user.id;
    return ctx.db.$transaction(
      async (tx) => {
        const rows = await plan(tx, chosen, input.events);
        const done: { mondayId: string; requestId: string; client: string }[] = [];
        let skipped = 0;
        const clientIds = new Map<string, string>(); // a client added once, for every deal of the same name
        for (const deal of chosen) {
          const row = rows.find((r) => r.mondayId === deal.mondayId)!;
          if (row.alreadyImported) {
            skipped++;
            continue;
          }
          let clientId = row.client.id ?? clientIds.get(deal.name.trim().toLowerCase()) ?? null;
          if (!clientId) {
            const created = await tx.client.create({ data: { name: deal.name.trim() } });
            clientId = created.id;
            clientIds.set(deal.name.trim().toLowerCase(), clientId);
            await logAudit(tx, { actorId, entity: "Client", entityId: clientId, summary: "Added — imported from monday.com" });
          }
          // Contacts: found on the client by email or name, else added to it.
          const contactIds: string[] = [];
          for (const contact of deal.contacts) {
            const known = await tx.clientContact.findFirst({
              where: {
                clientId,
                OR: [...(contact.email ? [{ email: { equals: contact.email.trim(), mode: "insensitive" as const } }] : []), { name: { equals: contact.name.trim(), mode: "insensitive" } }],
              },
              select: { id: true },
            });
            const id =
              known?.id ??
              (
                await tx.clientContact.create({
                  data: {
                    clientId,
                    name: contact.name.trim(),
                    title: blank(contact.title),
                    email: blank(contact.email),
                    mobile: blank(contact.mobile),
                    phone: blank(contact.phone),
                    accountManagerId: row.owner?.id ?? null,
                  },
                  select: { id: true },
                })
              ).id;
            if (!known) await logAudit(tx, { actorId, entity: "Client", entityId: clientId, summary: `Contact added: ${contact.name.trim()} — imported from monday.com` });
            contactIds.push(id);
          }
          const request = await tx.salesRequest.create({
            data: {
              clientId,
              contactId: contactIds[0] ?? null,
              eventId: row.event?.id ?? null,
              ownerId: row.owner?.id ?? null,
              stage: "INITIAL_INTEREST",
              description: blank(deal.description),
              location: blank(deal.location),
              rooms: blank(deal.rooms),
              period: blank(deal.period),
              budget: blank(deal.budget),
              prePost: blank(deal.prePost),
              rateIncludes: blank(deal.rateIncludes),
              extraServices: blank(deal.extraServices),
              mondayItemId: deal.mondayId,
              ...(deal.createdOn && { createdAt: parseDay(deal.createdOn) }),
            },
            select: { id: true },
          });
          await logAudit(tx, {
            actorId,
            entity: "SalesRequest",
            entityId: request.id,
            summary: `Imported from monday.com — deal "${deal.name}"${deal.createdOn ? ` of ${deal.createdOn}` : ""}${contactIds.length > 1 ? `, ${contactIds.length} contacts on the client` : ""}`,
          });
          done.push({ mondayId: deal.mondayId, requestId: request.id, client: deal.name });
        }
        return { imported: done.length, skipped, done };
      },
      { timeout: 120_000, maxWait: 15_000 },
    );
  }),
});
