import { ClientCategory, ContactType, Priority, type Prisma } from "generated/prisma";
import { TRPCError } from "@trpc/server";
import { z } from "zod";

import { clientCategoryLabels, clientCompanyFields, clientCompanyKeys, contactTypeLabels, priorityLabels } from "~/lib/clients";
import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";
import { diffFields, logAudit, logFieldChanges } from "~/server/audit";

/**
 * The B2B buyers: federations, broadcasters, sponsors, event teams — and the
 * people who work there (doc §4.10). Clients are global rather than per-event —
 * the same federation comes back for the next Games, and "what have we sold
 * this client, ever" is a question worth being able to answer. A lead is a
 * client that has not bought yet, not a separate record.
 */
const clientInput = z.object({
  name: z.string().min(1, "A client needs a name"),
  shortName: z.string().optional(),
  notes: z.string().optional(),
  category: z.nativeEnum(ClientCategory).nullable().optional(),
  accountManagerId: z.string().nullable().optional(),
  phone: z.string().max(200).optional(),
  email: z.string().trim().email("That email address does not look right").optional().or(z.literal("")),
  website: z.string().max(2000).optional(),
});

const contactInput = z.object({
  name: z.string().trim().min(1, "Give the contact a name"),
  title: z.string().max(200).optional(),
  email: z.string().trim().email("That email address does not look right").optional().or(z.literal("")),
  mobile: z.string().max(200).optional(),
  phone: z.string().max(200).optional(),
  type: z.nativeEnum(ContactType).nullable().optional(),
  priority: z.nativeEnum(Priority).nullable().optional(),
  accountManagerId: z.string().nullable().optional(),
  comments: z.string().max(5000).optional(),
});

const blank = (value: string | undefined) =>
  value?.trim() ? value.trim() : null;

const person = { select: { id: true, name: true, email: true, image: true } } as const;

/** Case-insensitive "contains" on each of the given text fields. */
const matching = (q: string, keys: string[]) =>
  keys.map((key) => ({ [key]: { contains: q, mode: "insensitive" as const } }));

const contactKeys = ["name", "email", "title", "mobile", "phone"];

/** A client found by its own details or by anyone who works there (doc §4.10). */
const clientWhere = (q: string): Prisma.ClientWhereInput | undefined =>
  q ? { OR: [...matching(q, ["name", "shortName", "email", "website"]), { contacts: { some: { OR: matching(q, contactKeys) } } }] } : undefined;

/** A person found by their own details or their company's name. */
const personWhere = (q: string): Prisma.ClientContactWhereInput | undefined =>
  q ? { OR: [...matching(q, contactKeys), { client: { OR: matching(q, ["name", "shortName"]) } }] } : undefined;

/**
 * Alphabetical as people read it (the owner, 2026-11-12): "adidas" among the
 * A's, not after Z, and "Österreich" with the O's. The database sorts capitals
 * first, so the names are sorted here and then the one page is fetched.
 */
const byName = new Intl.Collator("en", { sensitivity: "base", numeric: true });
async function pageOfIds(rows: Promise<{ id: string; name: string }[]>, input: { limit: number; offset: number }) {
  return (await rows)
    .sort((a, b) => byName.compare(a.name.trim(), b.name.trim()))
    .slice(input.offset, input.offset + input.limit)
    .map((row) => row.id);
}

/** A search, a page at a time: the list asks for 50 (doc §4.10); without a limit, 300 come back. */
const page = z.object({ q: z.string().max(200), limit: z.number().int().min(1).max(500).default(300), offset: z.number().int().min(0).default(0) });

/** How a client reads in its history — labels, not stored codes. */
const readableClient = (client: {
  name: string;
  shortName: string | null;
  notes: string | null;
  category: ClientCategory | null;
  accountManager: { name: string | null; email: string | null } | null;
  phone: string | null;
  email: string | null;
  website: string | null;
}) => ({
  ...client,
  category: client.category ? clientCategoryLabels[client.category] : null,
  accountManager: client.accountManager?.name ?? client.accountManager?.email ?? null,
});

const readableContact = (contact: {
  name: string;
  title: string | null;
  email: string | null;
  mobile: string | null;
  phone: string | null;
  type: ContactType | null;
  priority: Priority | null;
  comments: string | null;
  accountManager: { name: string | null; email: string | null } | null;
}) => ({
  ...contact,
  type: contact.type ? contactTypeLabels[contact.type] : null,
  priority: contact.priority ? priorityLabels[contact.priority] : null,
  accountManager: contact.accountManager?.name ?? contact.accountManager?.email ?? null,
});

const clientFields = [
  { key: "name", label: "Name" },
  { key: "shortName", label: "Short name" },
  { key: "category", label: "Category" },
  { key: "accountManager", label: "Account manager" },
  { key: "phone", label: "General phone" },
  { key: "email", label: "General email" },
  { key: "website", label: "Website" },
  { key: "notes", label: "Notes" },
] as const;

const contactFields = [
  { key: "name", label: "Name" },
  { key: "title", label: "Title" },
  { key: "email", label: "Email" },
  { key: "mobile", label: "Mobile" },
  { key: "phone", label: "Phone" },
  { key: "type", label: "Type" },
  { key: "priority", label: "Priority" },
  { key: "accountManager", label: "Account manager" },
  { key: "comments", label: "Comments" },
] as const;

const contactData = (input: z.infer<typeof contactInput>) => ({
  name: input.name.trim(),
  title: blank(input.title),
  email: blank(input.email),
  mobile: blank(input.mobile),
  phone: blank(input.phone),
  type: input.type ?? null,
  priority: input.priority ?? null,
  accountManagerId: input.accountManagerId ?? null,
  comments: blank(input.comments),
});

export const clientRouter = createTRPCRouter({
  /**
   * Delete a client (doc §4.10) — one made by mistake, twice, or for a test.
   * Refused while anything real hangs on it: a sales request, a contract,
   * rooms in the inventory. Its contacts and updates go with it; tasks about
   * it stay, no longer tied to it; its history is kept.
   */
  remove: protectedProcedure.input(z.object({ id: z.string() })).mutation(({ ctx, input }) =>
    ctx.db.$transaction(async (tx) => {
      const client = await tx.client.findUniqueOrThrow({
        where: { id: input.id },
        select: { id: true, name: true, _count: { select: { salesRequests: true, contracts: true, roomNights: true, requests: true } } },
      });
      const { salesRequests: requests, contracts, roomNights, requests: nightRequests } = client._count;
      if (requests) throw new TRPCError({ code: "BAD_REQUEST", message: `${client.name} has ${requests === 1 ? "a sales request" : `${requests} sales requests`}, so it cannot be deleted — delete ${requests === 1 ? "the request" : "them"} first.` });
      if (contracts) throw new TRPCError({ code: "BAD_REQUEST", message: `${client.name} has a contract, so it cannot be deleted.` });
      if (roomNights || nightRequests) throw new TRPCError({ code: "BAD_REQUEST", message: `${client.name} has rooms in the inventory — release or cancel them first.` });
      await tx.notification.deleteMany({ where: { link: { startsWith: `/clients/${client.id}` } } });
      await tx.client.delete({ where: { id: client.id } });
      await logAudit(tx, { actorId: ctx.session.user.id, entity: "Client", entityId: client.id, summary: `Client deleted: ${client.name}` });
      return { ok: true };
    }),
  ),

  list: protectedProcedure.query(({ ctx }) =>
    ctx.db.client.findMany({
      orderBy: { name: "asc" },
      include: {
        _count: { select: { roomNights: true, requests: true } },
      },
    }),
  ),

  /**
   * The Clients page, searched by company or by person (doc §4.10). A client
   * is found by its own name, short name, general email or website, or by any
   * of its contacts — and then says which contacts matched, so a search for
   * a person shows the company they are at.
   */
  search: protectedProcedure
    .input(page)
    .query(async ({ ctx, input }) => {
      const q = input.q.trim();
      const contactMatch: Prisma.ClientContactWhereInput = q ? { OR: matching(q, contactKeys) } : {};
      const ids = await pageOfIds(ctx.db.client.findMany({ where: clientWhere(q), select: { id: true, name: true } }), input);
      const found = await ctx.db.client.findMany({
        where: { id: { in: ids } },
        include: {
          accountManager: person,
          // Only nights sold to the client — not blocked, not cancelled.
          _count: { select: { roomNights: { where: { salesState: "SOLD" } }, requests: true, contacts: true } },
          contacts: q ? { where: contactMatch, orderBy: { name: "asc" }, take: 5, select: { id: true, name: true, title: true } } : false,
        },
      });
      const clients = ids.flatMap((id) => found.filter((client) => client.id === id));
      return clients.map(({ contacts, ...client }) => ({ ...client, matchedContacts: contacts ?? [] }));
    }),

  /** Every person at every client, searched by name, email, title or number — or by their company's name. */
  people: protectedProcedure
    .input(page)
    .query(async ({ ctx, input }) => {
      const q = input.q.trim();
      const ids = await pageOfIds(ctx.db.clientContact.findMany({ where: personWhere(q), select: { id: true, name: true } }), input);
      const found = await ctx.db.clientContact.findMany({
        where: { id: { in: ids } },
        include: { client: { select: { id: true, name: true, category: true } }, accountManager: person },
      });
      return ids.flatMap((id) => found.filter((contact) => contact.id === id));
    }),

  /** How many clients and people a search finds in all — the list shows them a page at a time. */
  counts: protectedProcedure.input(z.object({ q: z.string().max(200) })).query(async ({ ctx, input }) => {
    const q = input.q.trim();
    const [companies, people] = await Promise.all([ctx.db.client.count({ where: clientWhere(q) }), ctx.db.clientContact.count({ where: personWhere(q) })]);
    return { companies, people };
  }),

  byId: protectedProcedure
    .input(z.object({ id: z.string() }))
    .query(({ ctx, input }) =>
      ctx.db.client.findUnique({
        where: { id: input.id },
        include: {
          accountManager: person,
          contacts: { orderBy: { name: "asc" }, include: { accountManager: person } },
          _count: { select: { roomNights: { where: { salesState: "SOLD" } }, requests: true } },
        },
      }),
    ),

  create: protectedProcedure
    // With its first contact, when one is known — both saved together.
    .input(clientInput.extend({ contact: contactInput.optional() }))
    .mutation(async ({ ctx, input }) => {
      // Names are unique; two private people can share one, so say so plainly.
      const taken = await ctx.db.client.findFirst({ where: { name: { equals: input.name.trim(), mode: "insensitive" } }, select: { name: true } });
      if (taken) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            input.category === "PRIVATE_PERSON"
              ? `There is already a client called ${taken.name}. If this is someone else, tell them apart in the name — add their city, say.`
              : `${taken.name} is already a client — find them in the list instead.`,
        });
      }
      return ctx.db.$transaction(async (tx) => {
        const client = await tx.client.create({
          data: {
            name: input.name.trim(),
            shortName: blank(input.shortName),
            notes: blank(input.notes),
            category: input.category ?? null,
            accountManagerId: input.accountManagerId ?? null,
            phone: blank(input.phone),
            email: blank(input.email),
            website: blank(input.website),
          },
        });
        await logAudit(tx, {
          actorId: ctx.session.user.id,
          entity: "Client",
          entityId: client.id,
          summary: "Added",
        });
        if (!input.contact) return { ...client, contactId: null as string | null };
        const contact = await tx.clientContact.create({ data: { ...contactData(input.contact), clientId: client.id } });
        await logAudit(tx, { actorId: ctx.session.user.id, entity: "Client", entityId: client.id, summary: `Contact added: ${contact.name}` });
        return { ...client, contactId: contact.id as string | null };
      });
    }),

  update: protectedProcedure
    .input(clientInput.extend({ id: z.string() }))
    .mutation(({ ctx, input }) =>
      ctx.db.$transaction(async (tx) => {
        const include = { accountManager: { select: { name: true, email: true } } };
        const before = await tx.client.findUniqueOrThrow({ where: { id: input.id }, include });
        const data = {
          name: input.name.trim(),
          shortName: blank(input.shortName),
          notes: blank(input.notes),
          // Left out means unchanged: the stock sheet's quick "new client"
          // sends only a name.
          ...(input.category !== undefined && { category: input.category }),
          ...(input.accountManagerId !== undefined && { accountManagerId: input.accountManagerId }),
          ...(input.phone !== undefined && { phone: blank(input.phone) }),
          ...(input.email !== undefined && { email: blank(input.email) }),
          ...(input.website !== undefined && { website: blank(input.website) }),
        };
        const updated = await tx.client.update({ where: { id: input.id }, data, include });
        await logFieldChanges(
          tx,
          { actorId: ctx.session.user.id, entity: "Client", entityId: input.id, summary: "Updated" },
          readableClient(before),
          readableClient(updated),
          [...clientFields],
        );
        return updated;
      }),
    ),

  /**
   * The client's contracting details (doc §4.10) — who a contract is signed
   * with. Each change is in the client's history.
   */
  updateContracting: protectedProcedure
    .input(z.object({ id: z.string(), values: z.object(Object.fromEntries(clientCompanyKeys.map((key) => [key, z.string().max(2000)])) as Record<(typeof clientCompanyKeys)[number], z.ZodString>) }))
    .mutation(({ ctx, input }) =>
      ctx.db.$transaction(async (tx) => {
        const select = Object.fromEntries(clientCompanyKeys.map((key) => [key, true])) as Record<(typeof clientCompanyKeys)[number], true>;
        const before = await tx.client.findUniqueOrThrow({ where: { id: input.id }, select });
        const data = Object.fromEntries(clientCompanyKeys.map((key) => [key, blank(input.values[key])]));
        const after = await tx.client.update({ where: { id: input.id }, data, select });
        await logFieldChanges(
          tx,
          { actorId: ctx.session.user.id, entity: "Client", entityId: input.id, summary: "Contracting details updated" },
          before,
          after,
          clientCompanyFields.map(({ key, label }) => ({ key, label })),
        );
        return after;
      }),
    ),

  /** Add a person at a client, or change one (doc §4.10). */
  saveContact: protectedProcedure
    .input(z.object({ clientId: z.string(), id: z.string().optional(), contact: contactInput }))
    .mutation(({ ctx, input }) =>
      ctx.db.$transaction(async (tx) => {
        const include = { accountManager: { select: { name: true, email: true } } };
        const data = contactData(input.contact);
        if (!input.id) {
          const created = await tx.clientContact.create({ data: { ...data, clientId: input.clientId } });
          await logAudit(tx, {
            actorId: ctx.session.user.id,
            entity: "Client",
            entityId: input.clientId,
            summary: `Contact added: ${created.name}`,
          });
          return created;
        }
        const before = await tx.clientContact.findUniqueOrThrow({ where: { id: input.id }, include });
        const updated = await tx.clientContact.update({ where: { id: input.id }, data, include });
        const changes = diffFields(readableContact(before), readableContact(updated), [...contactFields]);
        if (changes) {
          await logAudit(tx, {
            actorId: ctx.session.user.id,
            entity: "Client",
            entityId: before.clientId,
            summary: `Contact updated: ${updated.name}`,
            changes,
          });
        }
        return updated;
      }),
    ),

  /** Remove a person from a client — say someone who has left the company. */
  removeContact: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(({ ctx, input }) =>
      ctx.db.$transaction(async (tx) => {
        const removed = await tx.clientContact.delete({ where: { id: input.id } });
        await logAudit(tx, {
          actorId: ctx.session.user.id,
          entity: "Client",
          entityId: removed.clientId,
          summary: `Contact removed: ${removed.name}`,
          changes: [removed.title, removed.email].filter(Boolean).join(" · ") || null,
        });
        return removed;
      }),
    ),
});
