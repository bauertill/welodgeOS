import { randomBytes } from "crypto";
import { TRPCError } from "@trpc/server";
import { z } from "zod";

import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";
import { logAudit } from "~/server/audit";

/**
 * Artifacts (doc §4.13): pages the team has Claude make — a presentation, a
 * comparison, a proposal — kept in OS as one HTML document each, and shown to
 * a client by a read-only link at /p/<token> once shared. Every replaced page
 * is kept as a version. The page is always served walled off from OS.
 */

/** The most a page may be: Vercel takes 4.5 MB in one request. */
export const MAX_HTML = 4_000_000;
const htmlInput = z
  .string()
  .min(20, "That page is empty.")
  .max(MAX_HTML, "That page is over 4 MB — move pictures to links, or make it smaller.")
  .refine((html) => /<(html|body|div|main|section|svg|h1|p|table)[\s>]/i.test(html), "That does not look like an HTML page.");
const titleInput = z.string().trim().min(1, "An artifact needs a title.").max(160);
const text = (max: number) => z.string().trim().max(max).optional();
const blank = (value?: string | null) => (value?.trim() ? value.trim() : null);
const token = () => randomBytes(24).toString("base64url");
const person = { select: { id: true, name: true, email: true } } as const;

const listSelect = {
  id: true,
  title: true,
  forLabel: true,
  description: true,
  event: { select: { id: true, name: true } },
  shareToken: true,
  shareEnabled: true,
  archived: true,
  createdAt: true,
  updatedAt: true,
  createdBy: person,
  updatedBy: person,
  _count: { select: { versions: true } },
} as const;

export const artifactRouter = createTRPCRouter({
  /** Every artifact, last changed first; the archived ones only when asked. */
  list: protectedProcedure
    .input(z.object({ archived: z.boolean().default(false), q: z.string().max(200).default("") }).default({}))
    .query(async ({ ctx, input }) => {
      const q = input.q.trim();
      return ctx.db.artifact.findMany({
        where: {
          archived: input.archived,
          ...(q && {
            OR: [
              { title: { contains: q, mode: "insensitive" } },
              { forLabel: { contains: q, mode: "insensitive" } },
              { description: { contains: q, mode: "insensitive" } },
            ],
          }),
        },
        orderBy: { updatedAt: "desc" },
        select: listSelect,
      });
    }),

  /** One artifact, with its earlier versions (not their pages). */
  byId: protectedProcedure.input(z.object({ id: z.string() })).query(async ({ ctx, input }) => {
    return ctx.db.artifact.findUnique({
      where: { id: input.id },
      select: {
        ...listSelect,
        versions: { orderBy: { number: "desc" }, select: { id: true, number: true, note: true, createdAt: true, createdBy: person } },
      },
    });
  }),

  /** The page itself — for Claude to read before changing it. */
  html: protectedProcedure.input(z.object({ id: z.string() })).query(async ({ ctx, input }) => {
    const row = await ctx.db.artifact.findUnique({ where: { id: input.id }, select: { title: true, html: true } });
    if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "That artifact no longer exists." });
    return row;
  }),

  /** A new artifact, from Claude or an uploaded HTML file. Not shared until shared. */
  create: protectedProcedure
    .input(z.object({ title: titleInput, html: htmlInput, forLabel: text(160), description: text(500), eventId: z.string().nullish(), note: text(60) }))
    .mutation(async ({ ctx, input }) => {
      const me = ctx.session.user.id;
      const row = await ctx.db.artifact.create({
        data: {
          title: input.title,
          html: input.html,
          forLabel: blank(input.forLabel),
          description: blank(input.description),
          eventId: input.eventId || null,
          createdById: me,
          updatedById: me,
        },
        select: { id: true, title: true },
      });
      await logAudit(ctx.db, { actorId: me, entity: "Artifact", entityId: row.id, summary: `Made "${row.title}"${input.note ? ` — ${input.note}` : ""}` });
      return row;
    }),

  /**
   * Change an artifact: its words, or a new page — the page it replaces is
   * kept as a version. A shared link shows the new page at once.
   */
  update: protectedProcedure
    .input(
      z.object({
        id: z.string(),
        title: titleInput.optional(),
        forLabel: text(160),
        description: text(500),
        eventId: z.string().nullish(),
        html: htmlInput.optional(),
        /** How the new page came: "via Claude", "uploaded". */
        note: text(60),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const me = ctx.session.user.id;
      return ctx.db.$transaction(async (tx) => {
        const current = await tx.artifact.findUnique({ where: { id: input.id }, select: { html: true, archived: true, title: true } });
        if (!current) throw new TRPCError({ code: "NOT_FOUND", message: "That artifact no longer exists." });
        if (current.archived) throw new TRPCError({ code: "BAD_REQUEST", message: "This artifact is archived — restore it first." });
        const newPage = input.html !== undefined && input.html !== current.html;
        if (newPage) {
          const last = await tx.artifactVersion.findFirst({ where: { artifactId: input.id }, orderBy: { number: "desc" }, select: { number: true } });
          await tx.artifactVersion.create({ data: { artifactId: input.id, number: (last?.number ?? 0) + 1, html: current.html, createdById: me } });
        }
        const row = await tx.artifact.update({
          where: { id: input.id },
          data: {
            ...(input.title !== undefined && { title: input.title }),
            ...(input.forLabel !== undefined && { forLabel: blank(input.forLabel) }),
            ...(input.description !== undefined && { description: blank(input.description) }),
            ...(input.eventId !== undefined && { eventId: input.eventId || null }),
            ...(newPage && { html: input.html }),
            updatedById: me,
          },
          select: { id: true, title: true, shareToken: true, shareEnabled: true, updatedAt: true },
        });
        await logAudit(tx, {
          actorId: me,
          entity: "Artifact",
          entityId: row.id,
          summary: newPage ? `New page for "${row.title}"${input.note ? ` — ${input.note}` : ""}; the last one kept as a version` : "Details changed",
        });
        return row;
      });
    }),

  /** Put an earlier version back — the page it replaces is kept as a version too. */
  restore: protectedProcedure.input(z.object({ id: z.string(), versionId: z.string() })).mutation(async ({ ctx, input }) => {
    const me = ctx.session.user.id;
    return ctx.db.$transaction(async (tx) => {
      const version = await tx.artifactVersion.findFirst({ where: { id: input.versionId, artifactId: input.id }, select: { html: true, number: true } });
      if (!version) throw new TRPCError({ code: "NOT_FOUND", message: "That version no longer exists." });
      const current = await tx.artifact.findUniqueOrThrow({ where: { id: input.id }, select: { html: true } });
      const last = await tx.artifactVersion.findFirst({ where: { artifactId: input.id }, orderBy: { number: "desc" }, select: { number: true } });
      await tx.artifactVersion.create({ data: { artifactId: input.id, number: (last?.number ?? 0) + 1, html: current.html, createdById: me } });
      await tx.artifact.update({ where: { id: input.id }, data: { html: version.html, updatedById: me } });
      await logAudit(tx, { actorId: me, entity: "Artifact", entityId: input.id, summary: `Version ${version.number} put back` });
      return { ok: true };
    });
  }),

  /** Archive (or bring back). An archived artifact's link stops working. */
  archive: protectedProcedure.input(z.object({ id: z.string(), archived: z.boolean().default(true) })).mutation(async ({ ctx, input }) => {
    const row = await ctx.db.artifact.update({ where: { id: input.id }, data: { archived: input.archived, updatedById: ctx.session.user.id }, select: { id: true } });
    await logAudit(ctx.db, { actorId: ctx.session.user.id, entity: "Artifact", entityId: row.id, summary: input.archived ? "Archived" : "Restored" });
    return row;
  }),

  /** Turn the client's link on or off; `regenerate` makes a new one, and the old stops working. */
  share: protectedProcedure.input(z.object({ id: z.string(), enabled: z.boolean(), regenerate: z.boolean().default(false) })).mutation(async ({ ctx, input }) => {
    const current = await ctx.db.artifact.findUniqueOrThrow({ where: { id: input.id }, select: { shareToken: true, updatedAt: true, archived: true } });
    if (current.archived && input.enabled) throw new TRPCError({ code: "BAD_REQUEST", message: "This artifact is archived — restore it first." });
    const row = await ctx.db.artifact.update({
      where: { id: input.id },
      data: { shareEnabled: input.enabled, updatedAt: current.updatedAt, ...((input.regenerate || (input.enabled && !current.shareToken)) && { shareToken: token() }) },
      select: { shareToken: true, shareEnabled: true },
    });
    await logAudit(ctx.db, {
      actorId: ctx.session.user.id,
      entity: "Artifact",
      entityId: input.id,
      summary: input.regenerate ? "Made a new client link" : input.enabled ? "Client link turned on" : "Client link turned off",
    });
    return row;
  }),
});
