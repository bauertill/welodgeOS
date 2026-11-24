import { randomBytes } from "crypto";
import { TRPCError } from "@trpc/server";
import { z } from "zod";

import type { Prisma } from "generated/prisma";
import { defaults, normalise } from "~/lib/stagger-model";
import { leaseDefaults, normaliseLease, normaliseReservations, type Reservation } from "~/lib/stagger-lease-model";
import { SEED_RESERVATIONS } from "~/lib/stagger-lease-seed";
import { createTRPCRouter, protectedProcedure, publicProcedure } from "~/server/api/trpc";
import { logAudit } from "~/server/audit";

/**
 * The Stagger Planner (doc §4.12): scenarios of how a client's apartments
 * arrive and leave in waves, and the owner's rent. Edited live by the team,
 * saved as they type; shown to the owner, read-only, by a share link. Only the
 * owner's rent is ever kept or returned — no margins, sell rates or costs.
 */

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "A date is YYYY-MM-DD.");
/** Studios, 1-beds and 2-beds; a scenario from before 2-beds came back sends none — its share 0, its rate the default. */
const perType = (twoDefault: number) => z.object({ studio: z.number().min(0), one: z.number().min(0), two: z.number().min(0).default(twoDefault) }).strip();
/** The planner's state exactly as the reference keeps it; never `presenting`. */
const dataInput = z
  .object({
    units: z.number().int().min(0).max(2000),
    first: day,
    waves: z.number().int().min(1).max(40),
    gap: z.number().int().min(1).max(60),
    stay: z.number().int().min(1).max(24),
    mix: perType(0),
    rates: perType(5500),
    rateBasis: z.enum(["month", "night"]),
    showBlock: z.boolean(),
    showRent: z.boolean(),
    rows: z.array(z.object({ date: day, units: z.number().int().min(0).max(2000), stay: z.number().int().min(1).max(24) })).max(200),
  })
  .strip();

/** A staggered lease's settings — every box on the reference's *Edit numbers* panel. */
const leaseInput = z
  .object({
    provider: z.string().max(120),
    client: z.string().max(120),
    version: z.string().max(200),
    units: z.number().int().min(1).max(2000),
    mix: z.array(z.object({ t: z.string().max(60), n: z.number().int().min(0).max(2000), r: z.number().min(0).max(1_000_000) }).strip()).min(1).max(12),
    cap: z.number().int().min(1).max(500),
    waves: z.string().max(60),
    dow: z.number().int().min(0).max(6),
    earliest: day,
    latest: day,
    minback: z.enum(["none", "g1", "g2"]),
    flex: z.number().int().min(0).max(60),
    r_open: day,
    r_close1: day,
    r_close2: day,
    t_open: day,
    t_close1: day,
    t_open2: day,
    t_close2: day,
  })
  .strip();
/** The reservation list: dates only, each check-out after its check-in. */
const reservationsInput = z
  .array(z.object({ checkIn: day, checkOut: day }).strip())
  .min(2, "A reservation list needs at least two stays.")
  .max(5000)
  .refine((rows) => rows.every((r) => r.checkOut > r.checkIn), "Each check-out must be after its check-in.");

export const seedReservations = (): Reservation[] => SEED_RESERVATIONS.map(([checkIn, checkOut]) => ({ checkIn, checkOut }));

type Row = { kind: string; data: Prisma.JsonValue; reservations: Prisma.JsonValue | null };
/** A scenario's settings read for its kind: the waves planner's data, or a lease's settings and reservations. */
function readKind<T extends Row>(row: T) {
  const { data, reservations, kind, ...rest } = row;
  return kind === "lease"
    ? { ...rest, kind: "lease" as const, lease: normaliseLease(data), reservations: normaliseReservations(reservations) }
    : { ...rest, kind: "waves" as const, data: normalise(data) };
}

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
      select: { id: true, name: true, event: true, clientLabel: true, kind: true, data: true, shareToken: true, shareEnabled: true, archived: true, updatedAt: true, updatedBy: person, createdBy: person },
    });
    return rows.map(({ data, ...row }) => ({ ...row, kind: row.kind === "lease" ? ("lease" as const) : ("waves" as const), units: row.kind === "lease" ? normaliseLease(data).units : normalise(data).units }));
  }),

  byId: protectedProcedure.input(z.object({ id: z.string() })).query(async ({ ctx, input }) => {
    const row = await ctx.db.staggerScenario.findUnique({
      where: { id: input.id },
      select: { id: true, name: true, event: true, clientLabel: true, kind: true, data: true, reservations: true, shareToken: true, shareEnabled: true, archived: true, updatedAt: true, updatedBy: person },
    });
    return row ? readKind(row) : null;
  }),

  /** A new scenario: waves at the 50-unit defaults, or a staggered lease at the reference's 60 with its reservation list. */
  create: protectedProcedure
    .input(z.object({ name: nameInput, event: text, clientLabel: text, kind: z.enum(["waves", "lease"]).default("waves") }))
    .mutation(async ({ ctx, input }) => {
    const me = ctx.session.user.id;
    const lease = input.kind === "lease" ? { ...leaseDefaults(), ...(blank(input.clientLabel) && { provider: blank(input.clientLabel)! }) } : null;
    const row = await ctx.db.staggerScenario.create({
      data: {
        name: input.name,
        event: blank(input.event),
        clientLabel: blank(input.clientLabel) ?? (lease ? lease.provider : null),
        kind: input.kind,
        data: lease ?? defaults(),
        ...(lease && { reservations: seedReservations() }),
        createdById: me,
        updatedById: me,
      },
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
    .input(
      z.object({
        id: z.string(),
        seen: z.date(),
        data: dataInput.optional(),
        /** A lease scenario's settings and its reservation list (doc §4.12). */
        lease: leaseInput.optional(),
        reservations: reservationsInput.optional(),
        name: nameInput.optional(),
        event: text,
        clientLabel: text,
      }),
    )
    .mutation(async ({ ctx, input }) => {
      if (input.data && (input.lease || input.reservations)) throw new TRPCError({ code: "BAD_REQUEST", message: "One kind of scenario at a time." });
      // A save is for the scenario's own kind: waves data never lands on a lease, nor the other way round.
      const kind = input.data ? "waves" : input.lease || input.reservations ? "lease" : undefined;
      const result = await ctx.db.staggerScenario.updateMany({
        where: { id: input.id, updatedAt: input.seen, archived: false, ...(kind && { kind }) },
        data: {
          ...(input.data && { data: input.data }),
          ...(input.lease && { data: input.lease }),
          ...(input.reservations && { reservations: input.reservations }),
          ...(input.name !== undefined && { name: input.name }),
          ...(input.event !== undefined && { event: blank(input.event) }),
          ...(input.clientLabel !== undefined && { clientLabel: blank(input.clientLabel) }),
          updatedById: ctx.session.user.id,
        },
      });
      if (result.count === 0) {
        const exists = await ctx.db.staggerScenario.findUnique({ where: { id: input.id }, select: { archived: true, kind: true } });
        if (!exists) throw new TRPCError({ code: "NOT_FOUND", message: "That scenario no longer exists." });
        if (kind && exists.kind !== kind) throw new TRPCError({ code: "BAD_REQUEST", message: "That is not this kind of scenario." });
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
      data: {
        name: `${from.name} (copy)`.slice(0, 120),
        event: from.event,
        clientLabel: from.clientLabel,
        kind: from.kind,
        data: from.kind === "lease" ? normaliseLease(from.data) : normalise(from.data),
        ...(from.kind === "lease" && { reservations: normaliseReservations(from.reservations) }),
        createdById: me,
        updatedById: me,
      },
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
      select: { name: true, clientLabel: true, kind: true, data: true, reservations: true },
    });
    if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "This link is no longer shared." });
    // Only what the page draws: names, the provider's rent, and reservation dates (no personal data).
    return readKind(row);
  }),
});
