import { randomBytes } from "crypto";
import { TRPCError } from "@trpc/server";
import { z } from "zod";

import { defaults, normalise } from "~/lib/stagger-model";
import { createTRPCRouter, protectedProcedure, publicProcedure } from "~/server/api/trpc";
import { logAudit } from "~/server/audit";

/**
 * The Stagger Planner (doc §4.12): scenarios of how a client's apartments
 * arrive and leave in waves, and the owner's rent. Edited live by the team,
 * saved as they type; shown to the owner, read-only, by a share link. Only the
 * owner's rent is ever kept or returned — no margins, sell rates or costs.
 */

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "A date is YYYY-MM-DD.");
const perType = z.object({ studio: z.number().min(0), one: z.number().min(0), two: z.number().min(0) });
/** The planner's state exactly as the reference keeps it; never `presenting`. */
const dataInput = z
  .object({
    units: z.number().int().min(0).max(2000),
    first: day,
    waves: z.number().int().min(1).max(40),
    gap: z.number().int().min(1).max(60),
    stay: z.number().int().min(1).max(24),
    mix: perType,
    rates: perType,
    rateBasis: z.enum(["month", "night"]),
    showBlock: z.boolean(),
    showRent: z.boolean(),
    rows: z.array(z.object({ date: day, units: z.number().int().min(0).max(2000), stay: z.number().int().min(1).max(24) })).max(200),
  })
  .strip();

const nameInput = z.string().trim().min(1, "A scenario needs a name.").max(120);
const text = z.string().trim().max(120).optional();
const blank = (value?: string | null) => (value?.trim() ? value.trim() : null);
const token = () => randomBytes(24).toString("base64url");

const person = { select: { id: true, name: true, email: true } } as const;

export const staggerRouter = createTRPCRouter({
  /** Every scenario, last edited first; the archived ones only when asked. */
  list: protectedProcedure.input(z.object({ archived: z.boolean().default(false) }).default({})).query(async ({ ctx, input }) => {
    const rows = await ctx.db.staggerScenario.findMany({
      where: { archived: input.archived },
      orderBy: { updatedAt: "desc" },
      select: { id: true, name: true, event: true, clientLabel: true, data: true, shareToken: true, shareEnabled: true, archived: true, updatedAt: true, updatedBy: person, createdBy: person },
    });
    return rows.map(({ data, ...row }) => ({ ...row, units: normalise(data).units }));
  }),

  byId: protectedProcedure.input(z.object({ id: z.string() })).query(async ({ ctx, input }) => {
    const row = await ctx.db.staggerScenario.findUnique({
      where: { id: input.id },
      select: { id: true, name: true, event: true, clientLabel: true, data: true, shareToken: true, shareEnabled: true, archived: true, updatedAt: true, updatedBy: person },
    });
    return row ? { ...row, data: normalise(row.data) } : null;
  }),

  /** A new scenario at the 50-unit defaults. */
  create: protectedProcedure.input(z.object({ name: nameInput, event: text, clientLabel: text })).mutation(async ({ ctx, input }) => {
    const me = ctx.session.user.id;
    const row = await ctx.db.staggerScenario.create({
      data: { name: input.name, event: blank(input.event), clientLabel: blank(input.clientLabel), data: defaults(), createdById: me, updatedById: me },
    });
    await logAudit(ctx.db, { actorId: me, entity: "StaggerScenario", entityId: row.id, summary: `Made "${row.name}"` });
    return row;
  }),

  /**
   * Save the planner as it is edited. `seen` is the last updatedAt the editor
   * had: if someone saved since, nothing is written and CONFLICT (409) comes
   * back, so nobody's change is silently overwritten.
   */
  update: protectedProcedure
    .input(z.object({ id: z.string(), seen: z.date(), data: dataInput.optional(), name: nameInput.optional(), event: text, clientLabel: text }))
    .mutation(async ({ ctx, input }) => {
      const result = await ctx.db.staggerScenario.updateMany({
        where: { id: input.id, updatedAt: input.seen, archived: false },
        data: {
          ...(input.data && { data: input.data }),
          ...(input.name !== undefined && { name: input.name }),
          ...(input.event !== undefined && { event: blank(input.event) }),
          ...(input.clientLabel !== undefined && { clientLabel: blank(input.clientLabel) }),
          updatedById: ctx.session.user.id,
        },
      });
      if (result.count === 0) {
        const exists = await ctx.db.staggerScenario.findUnique({ where: { id: input.id }, select: { archived: true } });
        if (!exists) throw new TRPCError({ code: "NOT_FOUND", message: "That scenario no longer exists." });
        throw new TRPCError({ code: "CONFLICT", message: exists.archived ? "This scenario was archived." : "Someone else changed this scenario – reload." });
      }
      const row = await ctx.db.staggerScenario.findUniqueOrThrow({ where: { id: input.id }, select: { updatedAt: true, updatedBy: person } });
      // Renames are audited; the many small saves while editing are not.
      if (input.name !== undefined || input.event !== undefined || input.clientLabel !== undefined) {
        await logAudit(ctx.db, { actorId: ctx.session.user.id, entity: "StaggerScenario", entityId: input.id, summary: "Renamed or relabelled" });
      }
      return row;
    }),

  /** A copy to try something else on — never shared until shared itself. */
  duplicate: protectedProcedure.input(z.object({ id: z.string() })).mutation(async ({ ctx, input }) => {
    const from = await ctx.db.staggerScenario.findUniqueOrThrow({ where: { id: input.id } });
    const me = ctx.session.user.id;
    const row = await ctx.db.staggerScenario.create({
      data: { name: `${from.name} (copy)`.slice(0, 120), event: from.event, clientLabel: from.clientLabel, data: normalise(from.data), createdById: me, updatedById: me },
    });
    await logAudit(ctx.db, { actorId: me, entity: "StaggerScenario", entityId: row.id, summary: `Copied from "${from.name}"` });
    return row;
  }),

  /** Archive (or bring back). An archived scenario's share link stops working. */
  archive: protectedProcedure.input(z.object({ id: z.string(), archived: z.boolean().default(true) })).mutation(async ({ ctx, input }) => {
    const row = await ctx.db.staggerScenario.update({ where: { id: input.id }, data: { archived: input.archived, updatedById: ctx.session.user.id } });
    await logAudit(ctx.db, { actorId: ctx.session.user.id, entity: "StaggerScenario", entityId: row.id, summary: input.archived ? "Archived" : "Restored" });
    return row;
  }),

  /** Turn the owner's link on or off; `regenerate` makes a new one, and the old stops working. */
  share: protectedProcedure.input(z.object({ id: z.string(), enabled: z.boolean(), regenerate: z.boolean().default(false) })).mutation(async ({ ctx, input }) => {
    const current = await ctx.db.staggerScenario.findUniqueOrThrow({ where: { id: input.id }, select: { shareToken: true, updatedAt: true } });
    const row = await ctx.db.staggerScenario.update({
      where: { id: input.id },
      // Sharing is not an edit: updatedAt is kept, so an open editor's next save is not refused.
      data: { shareEnabled: input.enabled, updatedAt: current.updatedAt, ...((input.regenerate || (input.enabled && !current.shareToken)) && { shareToken: token() }) },
      select: { shareToken: true, shareEnabled: true, updatedAt: true },
    });
    await logAudit(ctx.db, {
      actorId: ctx.session.user.id,
      entity: "StaggerScenario",
      entityId: input.id,
      summary: input.regenerate ? "Made a new share link" : input.enabled ? "Shared with the owner" : "Stopped sharing",
    });
    return row;
  }),

  /**
   * PUBLIC: the owner's read-only view by its link — the name, the owner's
   * label and the planner's data, nothing else. Not found once sharing is off
   * or the scenario is archived. Nothing public writes.
   */
  shared: publicProcedure.input(z.object({ token: z.string().min(16).max(100) })).query(async ({ ctx, input }) => {
    const row = await ctx.db.staggerScenario.findFirst({
      where: { shareToken: input.token, shareEnabled: true, archived: false },
      select: { name: true, clientLabel: true, data: true },
    });
    if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "This link is no longer shared." });
    return { name: row.name, clientLabel: row.clientLabel, data: normalise(row.data) };
  }),
});
