import type { Prisma, PrismaClient } from "generated/prisma";
import { TRPCError } from "@trpc/server";
import { z } from "zod";

import { areaRow, glanceRow, issueRow, readRows, SITE_VISIT_TEAM_TAG, verdictLabels, videoRow, visitInput, type VisitInput } from "~/lib/site-visits";
import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";
import { logAudit } from "~/server/audit";
import { deliverImmediate, notify } from "~/server/notify";

/**
 * Site visit reports (doc §3.12, the owner 2026-11-26): one visit to one or
 * several properties, each with its verdict, what was seen room by room, the
 * issues and needs, and the videos. Written on the site or by Claude through
 * the connector; shown on each property visited and on its provider.
 */

const person = { select: { id: true, name: true, email: true } } as const;
const blank = (value: string | null | undefined) => (value?.trim() ? value.trim() : null);
const include = {
  author: person,
  event: { select: { id: true, name: true } },
  provider: { select: { id: true, name: true } },
  units: { orderBy: { position: "asc" }, include: { property: { select: { id: true, name: true, city: true } } } },
} satisfies Prisma.SiteVisitInclude;

type Row = Prisma.SiteVisitGetPayload<{ include: typeof include }>;

/** Its lists read back in their shapes, whatever was stored. */
const shaped = (visit: Row) => ({
  ...visit,
  units: visit.units.map((unit) => ({
    ...unit,
    glance: readRows(unit.glance, glanceRow),
    areas: readRows(unit.areas, areaRow),
    issues: readRows(unit.issues, issueRow),
    videos: readRows(unit.videos, videoRow),
  })),
});
export type SiteVisitReport = ReturnType<typeof shaped>;

const unitRows = (units: VisitInput["units"]) =>
  units.map((unit, position) => ({
    propertyId: unit.propertyId || null,
    label: unit.label,
    position,
    verdict: unit.verdict ?? null,
    verdictNote: blank(unit.verdictNote),
    conclusion: blank(unit.conclusion),
    notes: blank(unit.notes),
    glance: unit.glance.filter((row) => row.value.trim()),
    areas: unit.areas.filter((row) => row.seen.trim()),
    issues: unit.issues.map((row) => ({ ...row, videoUrl: blank(row.videoUrl) ?? undefined, at: blank(row.at) ?? undefined })),
    videos: unit.videos,
  }));

const visitData = (input: VisitInput) => ({
  title: input.title,
  visitedOn: new Date(`${input.visitedOn}T00:00:00Z`),
  visitors: blank(input.visitors),
  guide: blank(input.guide),
  summary: blank(input.summary),
  eventId: input.eventId || null,
  providerId: input.providerId || null,
});

/** The properties named must exist — a wrong id is said, not saved. */
async function checkProperties(db: Pick<PrismaClient, "property">, input: VisitInput) {
  const ids = [...new Set(input.units.map((unit) => unit.propertyId).filter((id): id is string => Boolean(id)))];
  if (!ids.length) return;
  const found = await db.property.count({ where: { id: { in: ids } } });
  if (found !== ids.length) throw new TRPCError({ code: "BAD_REQUEST", message: "One of the properties in the report is not in the system — choose it again." });
}

export const siteVisitRouter = createTRPCRouter({
  /** Reports on a property (any of its units), a provider, or an event — newest visit first. */
  list: protectedProcedure
    .input(z.object({ propertyId: z.string().optional(), providerId: z.string().optional(), eventId: z.string().optional() }))
    .query(async ({ ctx, input }) => {
      const rows = await ctx.db.siteVisit.findMany({
        where: {
          ...(input.propertyId && { units: { some: { propertyId: input.propertyId } } }),
          ...(input.providerId && { OR: [{ providerId: input.providerId }, { units: { some: { property: { providerId: input.providerId } } } }] }),
          ...(input.eventId && { eventId: input.eventId }),
        },
        orderBy: [{ visitedOn: "desc" }, { createdAt: "desc" }],
        include,
        take: 100,
      });
      return rows.map(shaped);
    }),

  byId: protectedProcedure.input(z.object({ id: z.string() })).query(async ({ ctx, input }) => {
    const row = await ctx.db.siteVisit.findUnique({ where: { id: input.id }, include });
    return row ? shaped(row) : null;
  }),

  create: protectedProcedure.input(visitInput).mutation(async ({ ctx, input }) => {
    await checkProperties(ctx.db, input);
    const visit = await ctx.db.siteVisit.create({
      data: { ...visitData(input), authorId: ctx.session.user.id, units: { create: unitRows(input.units) } },
      include,
    });
    await logAudit(ctx.db, { actorId: ctx.session.user.id, entity: "SiteVisit", entityId: visit.id, summary: `Site visit report written: ${visit.title}` });
    for (const propertyId of new Set(visit.units.map((unit) => unit.propertyId).filter(Boolean))) {
      await logAudit(ctx.db, { actorId: ctx.session.user.id, entity: "Property", entityId: propertyId!, summary: `Site visit report: ${visit.title}` });
    }
    // A new report tags the @LA team (the owner, 2026-11-26) — told and emailed as if mentioned.
    const tag = await ctx.db.teamTag.findFirst({ where: { name: { equals: SITE_VISIT_TEAM_TAG, mode: "insensitive" } }, select: { members: { select: { id: true } } } });
    if (tag?.members.length) {
      await notify(ctx.db, {
        to: tag.members.map((member) => member.id),
        actorId: ctx.session.user.id,
        kind: "UPDATE_MENTION",
        title: `New site visit report: ${visit.title} (@${SITE_VISIT_TEAM_TAG})`,
        body: visit.units.map((unit) => `${unit.property?.name ?? unit.label}${unit.verdict ? ` — ${verdictLabels[unit.verdict]}` : ""}`).join("\n"),
        link: `/site-visits/${visit.id}`,
      });
      await deliverImmediate(ctx.db);
    }
    return shaped(visit);
  }),

  /** The whole report saved again: its places are replaced by those given. */
  update: protectedProcedure.input(visitInput.extend({ id: z.string() })).mutation(async ({ ctx, input }) => {
    await checkProperties(ctx.db, input);
    const visit = await ctx.db.$transaction(async (tx) => {
      await tx.siteVisitUnit.deleteMany({ where: { visitId: input.id } });
      return tx.siteVisit.update({ where: { id: input.id }, data: { ...visitData(input), units: { create: unitRows(input.units) } }, include });
    });
    await logAudit(ctx.db, { actorId: ctx.session.user.id, entity: "SiteVisit", entityId: visit.id, summary: `Site visit report changed: ${visit.title}` });
    return shaped(visit);
  }),

  remove: protectedProcedure.input(z.object({ id: z.string() })).mutation(async ({ ctx, input }) => {
    const visit = await ctx.db.siteVisit.delete({ where: { id: input.id } });
    await logAudit(ctx.db, { actorId: ctx.session.user.id, entity: "SiteVisit", entityId: visit.id, summary: `Site visit report deleted: ${visit.title}` });
  }),
});
