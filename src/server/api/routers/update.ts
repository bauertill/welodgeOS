import { type Prisma, UpdateKind } from "generated/prisma";
import { TRPCError } from "@trpc/server";
import { z } from "zod";

import { FILE_LINK_MESSAGE, isFileLink } from "~/lib/file-link";

import { parseDay } from "~/lib/dates";
import { updateKinds } from "~/lib/update-kinds";
import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";
import { deliverImmediate, mentionedIn, notify } from "~/server/notify";

/**
 * Updates: a chronological, append-only history of meeting notes, call
 * summaries and feedback — kept on a property, a hotel chain, a client or a
 * sales request the same way `LedgerEntry` keeps inventory changes (doc §2.6).
 * One update can be about several of these at once and shows on each; with
 * none, or only a provider kept by name, it lives on the Updates board alone.
 * Its author can edit it, which marks it as edited and keeps the wording it
 * replaced; nobody can delete one. A client's feed also shows the updates on
 * its sales requests; a property's, the updates on its chain.
 */
const scope = z
  .object({
    propertyId: z.string().optional(),
    clientId: z.string().optional(),
    salesRequestId: z.string().optional(),
    providerId: z.string().optional(),
    contractorId: z.string().optional(),
  })
  .refine((value) => [value.propertyId, value.clientId, value.salesRequestId, value.providerId, value.contractorId].filter(Boolean).length === 1, {
    message: "A feed is for exactly one property, chain, contractor, client or sales request.",
  });

const person = { select: { id: true, name: true, email: true, image: true } } as const;
/** Everything an update is about, for its links (doc §2.6). */
const about = {
  property: { select: { id: true, name: true } },
  provider: { select: { id: true, name: true } },
  contractor: { select: { id: true, name: true } },
  client: { select: { id: true, name: true } },
  salesRequest: { select: { id: true, client: { select: { id: true, name: true } }, event: { select: { name: true } } } },
} as const;
const withReplies = {
  author: person,
  ...about,
  replies: { orderBy: { createdAt: "asc" }, include: { author: person } },
} satisfies Prisma.UpdateInclude;

/** The Updates board's tabs (doc §2.6, the team 2026-11-17). */
export const BOARD_TABS = ["CLIENT", "ACCOMMODATION", "OTHER", "TEAM"] as const;
type BoardTab = (typeof BOARD_TABS)[number];

/** Which updates a tab holds; one about a property and a client is on both. */
function tabWhere(tab: BoardTab): Prisma.UpdateWhereInput {
  switch (tab) {
    case "CLIENT":
      return { OR: [{ clientId: { not: null } }, { salesRequestId: { not: null } }] };
    case "ACCOMMODATION":
      return { OR: [{ propertyId: { not: null } }, { providerId: { not: null } }] };
    // Other providers: those kept by name, and the contractors (doc §3.11).
    case "OTHER":
      return { OR: [{ otherProvider: { not: null } }, { contractorId: { not: null } }] };
    case "TEAM":
      return { propertyId: null, providerId: null, clientId: null, salesRequestId: null, otherProvider: null, contractorId: null };
  }
}

type Tags = { propertyId?: string | null; providerId?: string | null; contractorId?: string | null; clientId?: string | null; salesRequestId?: string | null; otherProvider?: string | null };

/** Where an update is read in full: its property, chain, client or request — or the board. */
function linkFor(tags: Tags) {
  if (tags.propertyId) return `/properties/${tags.propertyId}`;
  if (tags.providerId) return `/providers/${tags.providerId}`;
  if (tags.contractorId) return `/contractors/${tags.contractorId}`;
  if (tags.clientId) return `/clients/${tags.clientId}`;
  if (tags.salesRequestId) return `/sales/${tags.salesRequestId}`;
  return `/updates?tab=${tags.otherProvider ? "OTHER" : "TEAM"}`;
}

/** What it is about, in a few words, for a notification. */
function whereFor(update: {
  property?: { name: string } | null;
  provider?: { name: string } | null;
  contractor?: { name: string } | null;
  client?: { name: string } | null;
  salesRequest?: { client: { name: string } } | null;
  otherProvider?: string | null;
}) {
  return update.property?.name ?? update.provider?.name ?? update.contractor?.name ?? update.client?.name ?? update.salesRequest?.client.name ?? update.otherProvider ?? "the team's updates";
}

const fileUrl = z
  .string()
  .trim()
  .max(2000)
  .refine(isFileLink, FILE_LINK_MESSAGE)
  .optional();

export const updateRouter = createTRPCRouter({
  list: protectedProcedure.input(scope).query(async ({ ctx, input }) => {
    let where: Prisma.UpdateWhereInput;
    if (input.clientId) {
      // The client's own, and those on its sales requests (doc §2.6, 2026-11-10).
      where = { OR: [{ clientId: input.clientId }, { salesRequest: { clientId: input.clientId } }] };
    } else if (input.propertyId) {
      // The property's own, and those on its hotel chain (2026-11-17).
      const property = await ctx.db.property.findUnique({ where: { id: input.propertyId }, select: { providerId: true } });
      where = { OR: [{ propertyId: input.propertyId }, ...(property?.providerId ? [{ providerId: property.providerId }] : [])] };
    } else if (input.providerId) {
      // The chain's own, and those on each of its properties.
      where = { OR: [{ providerId: input.providerId }, { property: { providerId: input.providerId } }] };
    } else if (input.contractorId) {
      where = { contractorId: input.contractorId };
    } else {
      where = { salesRequestId: input.salesRequestId };
    }
    return ctx.db.update.findMany({
      where: { parentId: null, ...where },
      // Replies show beneath the update they answer, oldest first (2026-11-17).
      orderBy: { createdAt: "desc" },
      include: withReplies,
    });
  }),

  /**
   * The Updates board (doc §2.6, the team 2026-11-17): one tab's updates,
   * newest first, narrowed to one property, chain, client or provider name,
   * and to words in the text.
   */
  board: protectedProcedure
    .input(
      z.object({
        tab: z.enum(BOARD_TABS),
        propertyId: z.string().optional(),
        providerId: z.string().optional(),
        clientId: z.string().optional(),
        otherProvider: z.string().optional(),
        search: z.string().max(200).optional(),
        limit: z.number().int().min(1).max(200).default(30),
      }),
    )
    .query(async ({ ctx, input }) => {
      const narrow: Prisma.UpdateWhereInput[] = [tabWhere(input.tab)];
      if (input.propertyId) narrow.push({ propertyId: input.propertyId });
      // A chain: its own updates and its properties'.
      if (input.providerId) narrow.push({ OR: [{ providerId: input.providerId }, { property: { providerId: input.providerId } }] });
      if (input.clientId) narrow.push({ OR: [{ clientId: input.clientId }, { salesRequest: { clientId: input.clientId } }] });
      if (input.otherProvider) narrow.push({ otherProvider: { equals: input.otherProvider, mode: "insensitive" } });
      const words = input.search?.trim();
      if (words) {
        narrow.push({
          OR: [
            { body: { contains: words, mode: "insensitive" } },
            { replies: { some: { body: { contains: words, mode: "insensitive" } } } },
          ],
        });
      }
      const rows = await ctx.db.update.findMany({
        where: { parentId: null, AND: narrow },
        orderBy: { createdAt: "desc" },
        take: input.limit + 1,
        include: withReplies,
      });
      return { updates: rows.slice(0, input.limit), more: rows.length > input.limit };
    }),

  /** What the board's filters offer, from records that already exist (doc §2.6). */
  boardOptions: protectedProcedure.query(async ({ ctx }) => {
    const [properties, providers, clients, others] = await Promise.all([
      ctx.db.property.findMany({ select: { id: true, name: true, city: true }, orderBy: { name: "asc" } }),
      ctx.db.provider.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } }),
      ctx.db.client.findMany({ select: { id: true, name: true, shortName: true }, orderBy: { name: "asc" } }),
      ctx.db.update.findMany({ where: { otherProvider: { not: null } }, distinct: ["otherProvider"], select: { otherProvider: true } }),
    ]);
    return {
      properties,
      providers,
      clients,
      otherProviders: [...new Set(others.map((row) => row.otherProvider!.trim()))].sort((a, b) => a.localeCompare(b)),
    };
  }),

  /**
   * How many updates came in on each tab since this person last looked, not
   * counting their own — the red dots (doc §2.6). Never looked: the last week.
   */
  boardNew: protectedProcedure.query(async ({ ctx }) => {
    const userId = ctx.session.user.id;
    const seen = await ctx.db.updateBoardSeen.findMany({ where: { userId } });
    const weekAgo = new Date(Date.now() - 7 * 86_400_000);
    const counts = await Promise.all(
      BOARD_TABS.map(async (tab) => {
        const since = seen.find((row) => row.tab === tab)?.seenAt ?? weekAgo;
        const count = await ctx.db.update.count({
          where: { parentId: null, createdAt: { gt: since }, OR: [{ authorId: null }, { authorId: { not: userId } }], AND: [tabWhere(tab)] },
        });
        return [tab, { count, since }] as const;
      }),
    );
    return Object.fromEntries(counts) as Record<BoardTab, { count: number; since: Date }>;
  }),

  /** Looked at a tab: what was new is no longer. */
  markSeen: protectedProcedure.input(z.object({ tab: z.enum(BOARD_TABS) })).mutation(({ ctx, input }) =>
    ctx.db.updateBoardSeen.upsert({
      where: { userId_tab: { userId: ctx.session.user.id, tab: input.tab } },
      update: { seenAt: new Date() },
      create: { userId: ctx.session.user.id, tab: input.tab, seenAt: new Date() },
    }),
  ),

  post: protectedProcedure
    .input(
      z.object({
        propertyId: z.string().optional(),
        clientId: z.string().optional(),
        salesRequestId: z.string().optional(),
        providerId: z.string().optional(),
        contractorId: z.string().optional(),
        otherProvider: z.string().trim().max(200).optional(),
        body: z.string().min(1),
        kind: z.nativeEnum(UpdateKind).default("NOTE"),
        /** The day it took place, as YYYY-MM-DD; empty for a note. */
        happenedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
        /** A Google Drive link to the file that goes with it (doc §2.6). */
        fileUrl,
        /** Colleagues chosen to be told — emailed, as if @mentioned (doc §2.9). */
        notifyIds: z.array(z.string()).max(50).default([]),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const body = input.body.trim();
      if (!body) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "An update needs some text.",
        });
      }
      if (updateKinds[input.kind].propertyOnly && !input.propertyId) {
        throw new TRPCError({ code: "BAD_REQUEST", message: `${updateKinds[input.kind].label} is for a property.` });
      }
      const created = await ctx.db.update.create({
        data: {
          body,
          kind: input.kind,
          happenedOn: input.happenedOn ? parseDay(input.happenedOn) : null,
          propertyId: input.propertyId || null,
          clientId: input.clientId || null,
          salesRequestId: input.salesRequestId || null,
          providerId: input.providerId || null,
          contractorId: input.contractorId || null,
          otherProvider: input.otherProvider || null,
          fileUrl: input.fileUrl || null,
          authorId: ctx.session.user.id,
        },
        include: { author: person, ...about },
      });
      // Anyone @mentioned, or chosen to be told, hears of it — and is emailed (doc §2.9).
      const mentioned = await mentionedIn(ctx.db, body);
      const chosen = input.notifyIds.filter((id) => !mentioned.includes(id));
      const where = whereFor(created);
      const short = body.length > 300 ? `${body.slice(0, 297)}…` : body;
      const link = linkFor(created);
      const writer = ctx.session.user.name ?? "A colleague";
      await notify(ctx.db, { to: mentioned, actorId: ctx.session.user.id, kind: "UPDATE_MENTION", title: `${writer} mentioned you on ${where}`, body: short, link });
      await notify(ctx.db, { to: chosen, actorId: ctx.session.user.id, kind: "UPDATE_MENTION", title: `${writer} wants you to see an update on ${where}`, body: short, link });
      if (mentioned.length || chosen.length) await deliverImmediate(ctx.db);
      return created;
    }),

  /**
   * Reply to an update (doc §2.6, the team 2026-11-17): kept on the same
   * page as the update, beneath it. Whoever wrote the update, whoever replied
   * before, and anyone @mentioned is told.
   */
  reply: protectedProcedure
    .input(z.object({ parentId: z.string(), body: z.string().max(20_000) }))
    .mutation(async ({ ctx, input }) => {
      const body = input.body.trim();
      if (!body) throw new TRPCError({ code: "BAD_REQUEST", message: "A reply needs some text." });
      const parent = await ctx.db.update.findUnique({
        where: { id: input.parentId },
        select: {
          id: true,
          parentId: true,
          authorId: true,
          propertyId: true,
          clientId: true,
          salesRequestId: true,
          providerId: true,
          contractorId: true,
          otherProvider: true,
          replies: { select: { authorId: true } },
          ...about,
        },
      });
      if (!parent) throw new TRPCError({ code: "NOT_FOUND", message: "This update no longer exists." });
      if (parent.parentId) throw new TRPCError({ code: "BAD_REQUEST", message: "Reply to the update itself, not to a reply." });
      const reply = await ctx.db.update.create({
        data: {
          body,
          parentId: parent.id,
          propertyId: parent.propertyId,
          clientId: parent.clientId,
          salesRequestId: parent.salesRequestId,
          providerId: parent.providerId,
          contractorId: parent.contractorId,
          otherProvider: parent.otherProvider,
          authorId: ctx.session.user.id,
        },
      });
      const where = whereFor(parent);
      const mentioned = await mentionedIn(ctx.db, body);
      const link = linkFor(parent);
      const short = body.length > 300 ? `${body.slice(0, 297)}…` : body;
      // Mentioned: told and emailed. The writer and earlier repliers: told in the bell.
      await notify(ctx.db, { to: mentioned, actorId: ctx.session.user.id, kind: "UPDATE_MENTION", title: `${ctx.session.user.name ?? "A colleague"} mentioned you on ${where}`, body: short, link });
      await notify(ctx.db, {
        to: [parent.authorId, ...parent.replies.map((r) => r.authorId)].filter((id) => id && !mentioned.includes(id)),
        actorId: ctx.session.user.id,
        kind: "UPDATE_REPLY",
        title: `${ctx.session.user.name ?? "A colleague"} replied on ${where}`,
        body: short,
        link,
      });
      if (mentioned.length) await deliverImmediate(ctx.db);
      return reply;
    }),

  /**
   * Change the text of your own update. The wording it had is kept as a
   * revision, and the update records when it was edited, so the feed can say
   * so. Nobody can edit somebody else's.
   */
  edit: protectedProcedure
    .input(z.object({ id: z.string(), body: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const body = input.body.trim();
      if (!body) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "An update needs some text.",
        });
      }
      const existing = await ctx.db.update.findUnique({ where: { id: input.id } });
      if (!existing) {
        throw new TRPCError({ code: "NOT_FOUND", message: "This update no longer exists." });
      }
      if (existing.authorId !== ctx.session.user.id) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Only the person who wrote an update can edit it.",
        });
      }
      // Saving the same words is not an edit.
      if (body === existing.body) return existing;

      const [, updated] = await ctx.db.$transaction([
        ctx.db.updateRevision.create({
          data: { updateId: existing.id, body: existing.body },
        }),
        ctx.db.update.update({
          where: { id: existing.id },
          data: { body, editedAt: new Date() },
        }),
      ]);
      return updated;
    }),
});
