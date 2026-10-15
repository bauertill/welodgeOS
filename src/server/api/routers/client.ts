import { ClientCategory, ContactType, Priority, type Prisma } from "generated/prisma";
import { z } from "zod";

import { clientCategoryLabels, contactTypeLabels, priorityLabels } from "~/lib/clients";
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
    .input(z.object({ q: z.string().max(200) }))
    .query(async ({ ctx, input }) => {
      const q = input.q.trim();
      const contactMatch: Prisma.ClientContactWhereInput = q ? { OR: matching(q, contactKeys) } : {};
      const clients = await ctx.db.client.findMany({
        where: q
          ? {
              OR: [
                ...matching(q, ["name", "shortName", "email", "website"]),
                { contacts: { some: contactMatch } },
              ],
            }
          : undefined,
        orderBy: { name: "asc" },
        take: 300,
        include: {
          accountManager: person,
          // Only nights sold to the client — not blocked, not cancelled.
          _count: { select: { roomNights: { where: { salesState: "SOLD" } }, requests: true, contacts: true } },
          contacts: q ? { where: contactMatch, orderBy: { name: "asc" }, take: 5, select: { id: true, name: true, title: true } } : false,
        },
      });
      return clients.map(({ contacts, ...client }) => ({ ...client, matchedContacts: contacts ?? [] }));
    }),

  /** Every person at every client, searched by name, email, title or number — or by their company's name. */
  people: protectedProcedure
    .input(z.object({ q: z.string().max(200) }))
    .query(({ ctx, input }) => {
      const q = input.q.trim();
      return ctx.db.clientContact.findMany({
        where: q
          ? {
              OR: [
                ...matching(q, contactKeys),
                { client: { OR: matching(q, ["name", "shortName"]) } },
              ],
            }
          : undefined,
        orderBy: { name: "asc" },
        take: 300,
        include: { client: { select: { id: true, name: true } }, accountManager: person },
      });
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
    .mutation(({ ctx, input }) =>
      ctx.db.$transaction(async (tx) => {
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
      }),
    ),

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
