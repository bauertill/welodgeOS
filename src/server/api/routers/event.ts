import { TRPCError } from "@trpc/server";
import { z } from "zod";

import { dayKey, parseDay } from "~/lib/dates";
import { eventPeriodProblem } from "~/lib/event-periods";
import { formatRange } from "~/lib/format";
import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";
import { logAudit, logFieldChanges } from "~/server/audit";
import { driveAccount, folderIdFrom, googleDrive } from "~/server/drive";

const eventInput = z.object({
  name: z.string().min(1, "An event needs a name"),
  city: z.string().optional(),
  country: z.string().optional(),
  startDate: z.date(),
  endDate: z.date(),
  status: z.enum(["PLANNING", "ACTIVE", "CLOSED"]).default("PLANNING"),
  /** The currency its hotels quote in (doc §2.3). */
  currency: z.string().length(3).optional(),
  /** The event's folder on the shared drive, as a pasted link; "" clears it (doc §3.12). Left out, unchanged. */
  driveFolder: z.string().max(500).optional(),
});

/**
 * The pasted Drive link as a folder id, checked: OS must be able to open it
 * (the service account is a member of the shared drive), or nothing could be
 * made in it. Undefined: not sent, leave it.
 */
async function driveFolderOf(text: string | undefined) {
  if (text === undefined) return undefined;
  if (!text.trim()) return null;
  const id = folderIdFrom(text);
  if (!id) throw new TRPCError({ code: "BAD_REQUEST", message: "That does not look like a Google Drive folder link. Open the event's folder in Drive and copy the address from the browser." });
  const drive = googleDrive();
  if (drive) {
    const name = await drive.folderName(id).catch(() => null);
    if (!name) throw new TRPCError({ code: "BAD_REQUEST", message: `OS cannot open that folder. Check it is in the We Lodge shared drive, and that ${driveAccount()} is a member of it.` });
  }
  return id;
}

export const eventRouter = createTRPCRouter({
  list: protectedProcedure.query(({ ctx }) =>
    ctx.db.event.findMany({
      orderBy: { startDate: "asc" },
      include: {
        // The places distances are measured to (doc §3.7), named under the event.
        placesOfInterest: {
          where: { OR: [{ layer: { measured: true } }, { layerId: null, category: "VENUE" }] },
          orderBy: { name: "asc" },
          select: { id: true, name: true },
        },
        _count: { select: { scoutingEntries: true, roomNights: true } },
      },
    }),
  ),

  byId: protectedProcedure
    .input(z.object({ id: z.string() }))
    .query(({ ctx, input }) =>
      ctx.db.event.findUnique({
        where: { id: input.id },
        include: {
          placesOfInterest: {
            orderBy: [{ category: "asc" }, { name: "asc" }],
            include: { layer: { select: { id: true, name: true, color: true, measured: true } } },
          },
          mapLayers: {
            orderBy: [{ position: "asc" }, { name: "asc" }],
            select: { id: true, name: true, color: true, measured: true },
          },
          projectLead: { select: { id: true, name: true, email: true } },
          accommodationManagers: { select: { id: true, name: true, email: true }, orderBy: { name: "asc" } },
          periods: { orderBy: { startDate: "asc" } },
        },
      }),
    ),

  /** The event's named periods (doc §3.10), in date order, as days: none for most events. */
  periods: protectedProcedure.input(z.object({ eventId: z.string() })).query(async ({ ctx, input }) =>
    (await ctx.db.eventPeriod.findMany({ where: { eventId: input.eventId }, orderBy: { startDate: "asc" } })).map((period) => ({
      id: period.id,
      name: period.name,
      from: dayKey(period.startDate),
      to: dayKey(period.endDate),
    })),
  ),

  /**
   * Set the event's periods (doc §3.10) — the whole list at once, as edited.
   * Named, each with its first night and check-out day; they may leave gaps,
   * never overlap. Rates already recorded are not touched.
   */
  savePeriods: protectedProcedure
    .input(
      z.object({
        eventId: z.string(),
        periods: z
          .array(z.object({ name: z.string().trim().min(1).max(80), from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }))
          .max(20),
      }),
    )
    .mutation(({ ctx, input }) => {
      const problem = eventPeriodProblem(input.periods);
      if (problem) throw new TRPCError({ code: "BAD_REQUEST", message: problem });
      return ctx.db.$transaction(async (tx) => {
        const words = (periods: { name: string; startDate: Date; endDate: Date }[]) =>
          periods
            .slice()
            .sort((a, b) => a.startDate.getTime() - b.startDate.getTime())
            .map((period) => `${period.name} ${formatRange(period.startDate, period.endDate)}`)
            .join("; ") || "none";
        const before = await tx.eventPeriod.findMany({ where: { eventId: input.eventId } });
        await tx.eventPeriod.deleteMany({ where: { eventId: input.eventId } });
        const after = input.periods.map((period) => ({ eventId: input.eventId, name: period.name.trim(), startDate: parseDay(period.from), endDate: parseDay(period.to) }));
        if (after.length) await tx.eventPeriod.createMany({ data: after });
        if (words(before) !== words(after)) {
          await logAudit(tx, { actorId: ctx.session.user.id, entity: "Event", entityId: input.eventId, summary: "Periods changed", changes: `${words(before)} → ${words(after)}` });
        }
        return { ok: true };
      });
    }),

  /**
   * The event's team (doc §2.3): its project lead, and its accommodation
   * managers — who are given each new sales request's sourcing task (§4.11).
   */
  setTeam: protectedProcedure
    .input(z.object({ id: z.string(), projectLeadId: z.string().nullable(), accommodationManagerIds: z.array(z.string()).max(50) }))
    .mutation(({ ctx, input }) =>
      ctx.db.$transaction(async (tx) => {
        const name = (person: { name: string | null; email: string | null } | null) => (person ? (person.name ?? person.email ?? "") : "nobody");
        const select = { projectLead: { select: { name: true, email: true } }, accommodationManagers: { select: { name: true, email: true } } } as const;
        const before = await tx.event.findUniqueOrThrow({ where: { id: input.id }, include: select });
        const after = await tx.event.update({
          where: { id: input.id },
          data: { projectLeadId: input.projectLeadId, accommodationManagers: { set: input.accommodationManagerIds.map((id) => ({ id })) } },
          include: select,
        });
        const managers = (event: typeof before) => event.accommodationManagers.map(name).sort().join(", ") || "nobody";
        const changes = [
          name(before.projectLead) !== name(after.projectLead) ? `Project lead: ${name(before.projectLead)} → ${name(after.projectLead)}` : null,
          managers(before) !== managers(after) ? `Accommodation managers: ${managers(before)} → ${managers(after)}` : null,
        ]
          .filter(Boolean)
          .join("\n");
        if (changes) await logAudit(tx, { actorId: ctx.session.user.id, entity: "Event", entityId: input.id, summary: "Team changed", changes });
        return after;
      }),
    ),

  create: protectedProcedure
    .input(eventInput)
    .mutation(async ({ ctx, input }) => {
      const { driveFolder, ...fields } = input;
      const driveFolderId = await driveFolderOf(driveFolder);
      return ctx.db.$transaction(async (tx) => {
        const event = await tx.event.create({
          data: {
            ...fields,
            driveFolderId: driveFolderId ?? null,
            city: fields.city?.trim() || null,
            country: fields.country?.trim() || null,
          },
        });
        await logAudit(tx, {
          actorId: ctx.session.user.id,
          entity: "Event",
          entityId: event.id,
          summary: "Created",
        });
        return event;
      });
    }),

  update: protectedProcedure
    .input(eventInput.extend({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const { id, driveFolder, ...fields } = input;
      const driveFolderId = await driveFolderOf(driveFolder);
      return ctx.db.$transaction(async (tx) => {
        const data = { ...fields, ...(driveFolderId !== undefined && { driveFolderId }) };
        const before = await tx.event.findUniqueOrThrow({ where: { id } });
        const updated = await tx.event.update({ where: { id }, data });
        await logFieldChanges(
          tx,
          { actorId: ctx.session.user.id, entity: "Event", entityId: id, summary: "Updated" },
          before,
          updated,
          [
            { key: "name", label: "Name" },
            { key: "city", label: "City" },
            { key: "country", label: "Country" },
            { key: "startDate", label: "Start date" },
            { key: "endDate", label: "End date" },
            { key: "status", label: "Status" },
            { key: "currency", label: "Currency" },
            { key: "driveFolderId", label: "Drive folder" },
          ],
        );
        return updated;
      });
    }),
});
