import { Prisma } from "generated/prisma";
import { TRPCError } from "@trpc/server";
import { z } from "zod";

import { parseDay } from "~/lib/dates";
import { formatDate } from "~/lib/format";
import { blocksCheckIn, checklistInput, readChecklist, readinessOf, standardChecklist, type ChecklistSection } from "~/lib/inspections";
import { isApartmentLike } from "~/lib/scouting";
import { taskRouter } from "~/server/api/routers/task";
import { createCallerFactory, createTRPCRouter, protectedProcedure } from "~/server/api/trpc";
import { logAudit } from "~/server/audit";

/**
 * Apartment inspections and defects (doc §6.10, Phase 3 step 3): the standard
 * checklists, each room type's own, planning an inspection (with the
 * inspector's task), walking it on a phone, the defects it finds, the tasks
 * that fix them and the check that they are fixed. Apartments only — hotels
 * inspect their own rooms.
 */

const person = { select: { id: true, name: true, email: true } } as const;
const photoInput = z.object({ url: z.string().min(1).max(2000), name: z.string().max(300).nullish() });
const severity = z.enum(["BEFORE_CHECK_IN", "MUST_FIX", "DOCUMENT", "NOT_SURE"]);
const taskCaller = createCallerFactory(taskRouter);
/** A calendar day as the forms send it — "2026-07-08", or empty. */
const optionalDay = z.string().regex(/^(\d{4}-\d{2}-\d{2})?$/, "That date does not look right").optional();
const asDay = (value: string | undefined) => (value ? parseDay(value) : null);

type Db = Prisma.TransactionClient;

/** The standard checklists — the first is made from the EXPO Osaka sheets the first time anyone looks. */
async function templates(db: Db) {
  const rows = await db.checklistTemplate.findMany({ orderBy: [{ isDefault: "desc" }, { name: "asc" }], include: { updatedBy: person } });
  if (rows.length) return rows;
  await db.checklistTemplate.create({ data: { name: "Standard apartment", sections: standardChecklist(), isDefault: true } });
  return db.checklistTemplate.findMany({ orderBy: [{ isDefault: "desc" }, { name: "asc" }], include: { updatedBy: person } });
}

/** The checklist an apartment of this room type is inspected with: its own, else the default standard one. */
async function checklistFor(db: Db, categoryId: string): Promise<ChecklistSection[]> {
  const category = await db.roomCategory.findUniqueOrThrow({ where: { id: categoryId }, select: { checklist: true } });
  const own = readChecklist(category.checklist);
  if (own.length) return own;
  const all = await templates(db);
  return readChecklist((all.find((one) => one.isDefault) ?? all[0])?.sections);
}

/** "Bay Wheel · Apt 1203" — the building's own number when known, else ours. */
const unitName = (slot: { slotNumber: number; unitNumber: string | null; category: { name: string; property: { name: string } } }) =>
  `${slot.category.property.name} · ${slot.unitNumber ? `Apt ${slot.unitNumber}` : `${slot.category.name} #${slot.slotNumber}`}`;

const slotSelect = {
  id: true,
  slotNumber: true,
  unitNumber: true,
  category: { select: { id: true, name: true, property: { select: { id: true, name: true, type: true } } } },
} as const;

/** A task type by name, made the first time it is needed. */
async function taskType(db: Db, name: string) {
  const existing = await db.taskType.findFirst({ where: { name: { equals: name, mode: "insensitive" } } });
  return existing ?? db.taskType.create({ data: { name } });
}

export const inspectionRouter = createTRPCRouter({
  // --- The standard checklists -------------------------------------------------------

  templates: protectedProcedure.query(({ ctx }) => ctx.db.$transaction((tx) => templates(tx))),

  saveTemplate: protectedProcedure
    .input(z.object({ id: z.string().optional(), name: z.string().trim().min(1, "Give the checklist a name.").max(100), sections: checklistInput }))
    .mutation(async ({ ctx, input }) => {
      const clash = await ctx.db.checklistTemplate.findFirst({ where: { name: { equals: input.name, mode: "insensitive" }, ...(input.id && { id: { not: input.id } }) } });
      if (clash) throw new TRPCError({ code: "BAD_REQUEST", message: `There is already a checklist called "${input.name}".` });
      const data = { name: input.name, sections: input.sections, updatedById: ctx.session.user.id };
      const row = input.id ? await ctx.db.checklistTemplate.update({ where: { id: input.id }, data }) : await ctx.db.checklistTemplate.create({ data });
      await logAudit(ctx.db, { actorId: ctx.session.user.id, entity: "ChecklistTemplate", entityId: row.id, summary: `${input.id ? "Checklist changed" : "Checklist added"}: ${row.name}` });
      return row;
    }),

  setDefaultTemplate: protectedProcedure.input(z.object({ id: z.string() })).mutation(async ({ ctx, input }) => {
    await ctx.db.$transaction([
      ctx.db.checklistTemplate.updateMany({ data: { isDefault: false } }),
      ctx.db.checklistTemplate.update({ where: { id: input.id }, data: { isDefault: true } }),
    ]);
  }),

  removeTemplate: protectedProcedure.input(z.object({ id: z.string() })).mutation(async ({ ctx, input }) => {
    const row = await ctx.db.checklistTemplate.findUniqueOrThrow({ where: { id: input.id } });
    if (row.isDefault) throw new TRPCError({ code: "BAD_REQUEST", message: "This is the standard checklist — make another the standard first." });
    await ctx.db.checklistTemplate.delete({ where: { id: input.id } });
    await logAudit(ctx.db, { actorId: ctx.session.user.id, entity: "ChecklistTemplate", entityId: row.id, summary: `Checklist removed: ${row.name}` });
  }),

  /** A room type's checklist: its own if adjusted, else the standard one it would use. */
  roomTypeChecklist: protectedProcedure.input(z.object({ categoryId: z.string() })).query(async ({ ctx, input }) => {
    const category = await ctx.db.roomCategory.findUniqueOrThrow({ where: { id: input.categoryId }, select: { name: true, checklist: true, property: { select: { name: true } } } });
    const own = readChecklist(category.checklist);
    return { name: category.name, property: category.property.name, own: own.length > 0, sections: own.length ? own : await ctx.db.$transaction((tx) => checklistFor(tx, input.categoryId)) };
  }),

  /** Adjust a room type's checklist — or, with none, put it back to the standard one. Inspections already planned keep theirs. */
  setRoomTypeChecklist: protectedProcedure.input(z.object({ categoryId: z.string(), sections: checklistInput.nullable() })).mutation(async ({ ctx, input }) => {
    const row = await ctx.db.roomCategory.update({
      where: { id: input.categoryId },
      data: { checklist: input.sections?.length ? input.sections : Prisma.DbNull },
      select: { name: true, propertyId: true },
    });
    await logAudit(ctx.db, { actorId: ctx.session.user.id, entity: "Property", entityId: row.propertyId, summary: input.sections?.length ? `Inspection checklist adjusted for ${row.name}` : `Inspection checklist for ${row.name} back to the standard one` });
  }),

  // --- An event's apartments -----------------------------------------------------------

  /**
   * Every apartment we hold at the event — a room at an apartment-type property
   * with nights bought from the supplier or sold to a client — with its first
   * check-in, its latest inspection, its defects and where it stands; and the
   * defect inbox: what is open, unjudged or fixed and waiting to be checked.
   */
  overview: protectedProcedure.input(z.object({ eventId: z.string() })).query(async ({ ctx, input }) => {
    const nights = await ctx.db.roomNight.groupBy({
      by: ["slotId"],
      where: { eventId: input.eventId, OR: [{ acquisitionState: "BOUGHT" }, { salesState: "SOLD" }] },
      _min: { date: true },
    });
    const slots = nights.length
      ? await ctx.db.roomSlot.findMany({
          where: { id: { in: nights.map((night) => night.slotId) } },
          select: {
            ...slotSelect,
            roomingStays: { where: { removedAt: null }, select: { checkIn: true }, orderBy: { checkIn: "asc" }, take: 1 },
            inspections: { where: { eventId: input.eventId }, orderBy: { createdAt: "desc" }, take: 1, select: { id: true, status: true, scheduledOn: true, finishedAt: true, inspector: person } },
            defects: { where: { eventId: input.eventId }, select: { severity: true, status: true } },
          },
        })
      : [];
    const firstNight = new Map(nights.map((night) => [night.slotId, night._min.date]));
    const apartments = slots
      .filter((slot) => isApartmentLike(slot.category.property.type))
      .map((slot) => {
        const latest = slot.inspections[0] ?? null;
        return {
          slotId: slot.id,
          slotNumber: slot.slotNumber,
          unitNumber: slot.unitNumber,
          categoryId: slot.category.id,
          roomType: slot.category.name,
          propertyId: slot.category.property.id,
          property: slot.category.property.name,
          firstCheckIn: slot.roomingStays[0]?.checkIn ?? firstNight.get(slot.id) ?? null,
          inspection: latest,
          openDefects: slot.defects.filter((defect) => defect.status !== "CHECKED").length,
          blocking: slot.defects.filter(blocksCheckIn).length,
          readiness: readinessOf(latest, slot.defects),
        };
      })
      .sort((a, b) => a.property.localeCompare(b.property) || a.roomType.localeCompare(b.roomType) || a.slotNumber - b.slotNumber);

    const inbox = await ctx.db.defect.findMany({
      where: { eventId: input.eventId, OR: [{ status: "FIXED" }, { status: "OPEN", severity: { not: "DOCUMENT" } }] },
      orderBy: [{ createdAt: "asc" }],
      include: { slot: { select: slotSelect }, task: { select: { id: true, title: true, status: true, deadline: true, assignees: person } }, createdBy: person },
    });
    return {
      apartments,
      inbox: inbox.map((defect) => ({ ...defect, unit: unitName(defect.slot), propertyId: defect.slot.category.property.id })),
    };
  }),

  /**
   * Plan inspections: a date and who goes, for one apartment or several. Each
   * gets the room type's checklist as it stands, and the inspector a task on
   * the board for that day.
   */
  plan: protectedProcedure
    .input(z.object({ eventId: z.string(), slotIds: z.array(z.string()).min(1).max(200), scheduledOn: optionalDay, inspectorId: z.string().nullable() }))
    .mutation(async ({ ctx, input }) => {
      const tasks = taskCaller(ctx);
      const type = await taskType(ctx.db, "Inspection");
      const slots = await ctx.db.roomSlot.findMany({ where: { id: { in: input.slotIds } }, select: slotSelect });
      const made: string[] = [];
      for (const slot of slots) {
        const open = await ctx.db.inspection.findFirst({ where: { eventId: input.eventId, slotId: slot.id, status: { not: "DONE" } }, select: { id: true, taskId: true } });
        const checklist = await ctx.db.$transaction((tx) => checklistFor(tx, slot.category.id));
        const inspection = open
          ? await ctx.db.inspection.update({ where: { id: open.id }, data: { scheduledOn: asDay(input.scheduledOn), inspectorId: input.inspectorId } })
          : await ctx.db.inspection.create({ data: { eventId: input.eventId, slotId: slot.id, scheduledOn: asDay(input.scheduledOn), inspectorId: input.inspectorId, checklist, createdById: ctx.session.user.id } });
        const title = `Inspect ${unitName(slot)}`;
        if (open?.taskId) {
          await tasks.update({ id: open.taskId, deadline: input.scheduledOn ?? "", assigneeIds: input.inspectorId ? [input.inspectorId] : [] });
        } else {
          const task = await tasks.create({
            title,
            details: `Walk the apartment with its checklist on your phone: photos from every angle, tick what works, count what is there, and add a defect for anything not right.\n\nOpen the inspection: /inspections/${inspection.id}`,
            deadline: input.scheduledOn ?? "",
            typeId: type.id,
            assigneeIds: input.inspectorId ? [input.inspectorId] : [],
            eventId: input.eventId,
            propertyId: slot.category.property.id,
          });
          await ctx.db.inspection.update({ where: { id: inspection.id }, data: { taskId: task.id } });
        }
        await logAudit(ctx.db, {
          actorId: ctx.session.user.id,
          entity: "Property",
          entityId: slot.category.property.id,
          summary: `Inspection planned: ${unitName(slot)}${input.scheduledOn ? `, ${formatDate(parseDay(input.scheduledOn))}` : ""}`,
        });
        made.push(inspection.id);
      }
      return { inspectionIds: made };
    }),

  /** One inspection, to walk or read: the checklist, every answer, the photos, and the apartment's defects at the event. */
  byId: protectedProcedure.input(z.object({ id: z.string() })).query(async ({ ctx, input }) => {
    const row = await ctx.db.inspection.findUnique({
      where: { id: input.id },
      include: {
        event: { select: { id: true, name: true } },
        slot: { select: slotSelect },
        inspector: person,
        results: true,
        photos: { orderBy: { createdAt: "asc" } },
        task: { select: { id: true, status: true } },
      },
    });
    if (!row) return null;
    const defects = await ctx.db.defect.findMany({
      where: { eventId: row.eventId, slotId: row.slotId },
      orderBy: { createdAt: "asc" },
      include: { task: { select: { id: true, title: true, status: true, assignees: person } }, createdBy: person, checkedBy: person },
    });
    return {
      ...row,
      unit: unitName(row.slot),
      checklist: readChecklist(row.checklist),
      defects: defects.map((defect) => ({ ...defect, photos: (defect.photos as { url: string; name?: string | null }[]) ?? [] })),
      readiness: readinessOf(row, defects),
    };
  }),

  /** On the apartment's page: start walking it. */
  start: protectedProcedure.input(z.object({ id: z.string() })).mutation(async ({ ctx, input }) => {
    const row = await ctx.db.inspection.findUniqueOrThrow({ where: { id: input.id }, select: { status: true, inspectorId: true, taskId: true } });
    if (row.status !== "PLANNED") return;
    await ctx.db.inspection.update({ where: { id: input.id }, data: { status: "IN_PROGRESS", startedAt: new Date(), inspectorId: row.inspectorId ?? ctx.session.user.id } });
    if (row.taskId) await ctx.db.task.update({ where: { id: row.taskId }, data: { status: "IN_PROGRESS", boardOrder: null } });
  }),

  /** One item's answer — works or not, how many — saved as it is tapped. */
  setResult: protectedProcedure
    .input(z.object({ inspectionId: z.string(), itemId: z.string().max(40), ok: z.boolean().nullable().optional(), count: z.number().int().min(0).max(999).nullable().optional(), note: z.string().max(1000).nullable().optional() }))
    .mutation(async ({ ctx, input }) => {
      const { inspectionId, itemId, ...answer } = input;
      await ctx.db.inspectionResult.upsert({ where: { inspectionId_itemId: { inspectionId, itemId } }, create: { inspectionId, itemId, ...answer }, update: answer });
    }),

  addPhotos: protectedProcedure.input(z.object({ inspectionId: z.string(), photos: z.array(photoInput).min(1).max(100) })).mutation(async ({ ctx, input }) => {
    await ctx.db.inspectionPhoto.createMany({ data: input.photos.map((photo) => ({ inspectionId: input.inspectionId, url: photo.url, name: photo.name ?? null })) });
  }),

  removePhoto: protectedProcedure.input(z.object({ id: z.string() })).mutation(async ({ ctx, input }) => {
    await ctx.db.inspectionPhoto.delete({ where: { id: input.id } });
  }),

  /** Finished on site: the inspector's task is done, and the apartment is ready unless a defect stops it. */
  finish: protectedProcedure.input(z.object({ id: z.string(), memo: z.string().max(5000).optional() })).mutation(async ({ ctx, input }) => {
    const row = await ctx.db.inspection.update({
      where: { id: input.id },
      data: { status: "DONE", finishedAt: new Date(), memo: input.memo?.trim() || null },
      include: { slot: { select: slotSelect } },
    });
    if (row.taskId) await taskCaller(ctx).update({ id: row.taskId, status: "DONE" });
    const defects = await ctx.db.defect.findMany({ where: { eventId: row.eventId, slotId: row.slotId }, select: { severity: true, status: true } });
    await logAudit(ctx.db, { actorId: ctx.session.user.id, entity: "Property", entityId: row.slot.category.property.id, summary: `Inspection done: ${unitName(row.slot)}` });
    return { readiness: readinessOf(row, defects) };
  }),

  /** Back to walking it — something was missed. */
  reopen: protectedProcedure.input(z.object({ id: z.string() })).mutation(async ({ ctx, input }) => {
    await ctx.db.inspection.update({ where: { id: input.id }, data: { status: "IN_PROGRESS", finishedAt: null } });
  }),

  // --- Defects ---------------------------------------------------------------------------

  addDefect: protectedProcedure
    .input(
      z.object({
        inspectionId: z.string(),
        itemId: z.string().max(40).nullish(),
        area: z.string().max(100).nullish(),
        description: z.string().trim().min(1, "Say what is wrong.").max(2000),
        severity,
        photos: z.array(photoInput).max(30).default([]),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const inspection = await ctx.db.inspection.findUniqueOrThrow({ where: { id: input.inspectionId }, select: { eventId: true, slotId: true } });
      // One defect per checklist item while it is open: a second tap changes it rather than adding another.
      const existing = input.itemId
        ? await ctx.db.defect.findFirst({ where: { inspectionId: input.inspectionId, itemId: input.itemId, status: { not: "CHECKED" } }, select: { id: true } })
        : null;
      const data = { area: input.area ?? null, description: input.description, severity: input.severity, photos: input.photos };
      const defect = existing
        ? await ctx.db.defect.update({ where: { id: existing.id }, data })
        : await ctx.db.defect.create({ data: { ...data, eventId: inspection.eventId, slotId: inspection.slotId, inspectionId: input.inspectionId, itemId: input.itemId ?? null, createdById: ctx.session.user.id } });
      return { id: defect.id };
    }),

  /** Change a defect: its words, how serious (the office deciding a "Not sure"), its photos. */
  updateDefect: protectedProcedure
    .input(z.object({ id: z.string(), description: z.string().trim().min(1).max(2000).optional(), severity: severity.optional(), photos: z.array(photoInput).max(30).optional() }))
    .mutation(async ({ ctx, input }) => {
      const { id, ...data } = input;
      await ctx.db.defect.update({ where: { id }, data });
    }),

  /** Taken back — added by mistake. Not once a task is fixing it. */
  removeDefect: protectedProcedure.input(z.object({ id: z.string() })).mutation(async ({ ctx, input }) => {
    const defect = await ctx.db.defect.findUniqueOrThrow({ where: { id: input.id }, select: { taskId: true } });
    if (defect.taskId) throw new TRPCError({ code: "BAD_REQUEST", message: "A task is fixing this defect — check it instead." });
    await ctx.db.defect.delete({ where: { id: input.id } });
  }),

  /** From the defect inbox: a cleaning, maintenance or other task that fixes it. Done, the defect is fixed — to be checked. */
  defectTask: protectedProcedure
    .input(z.object({ defectId: z.string(), kind: z.enum(["Cleaning", "Maintenance", "Other"]), assigneeIds: z.array(z.string()).max(10), deadline: optionalDay }))
    .mutation(async ({ ctx, input }) => {
      const defect = await ctx.db.defect.findUniqueOrThrow({ where: { id: input.defectId }, include: { slot: { select: slotSelect } } });
      if (defect.taskId) throw new TRPCError({ code: "BAD_REQUEST", message: "This defect already has a task." });
      const type = input.kind === "Other" ? null : await taskType(ctx.db, input.kind);
      const task = await taskCaller(ctx).create({
        title: `${input.kind === "Other" ? "Fix" : input.kind}: ${defect.description} — ${unitName(defect.slot)}`.slice(0, 300),
        details: `${defect.area ? `${defect.area}: ` : ""}${defect.description}\n\nOnce it is fixed, mark this task Done — the defect then waits to be checked on the apartment's inspection.${defect.inspectionId ? `\n\nThe inspection: /inspections/${defect.inspectionId}` : ""}`,
        deadline: input.deadline ?? "",
        typeId: type?.id ?? null,
        assigneeIds: input.assigneeIds,
        eventId: defect.eventId,
        propertyId: defect.slot.category.property.id,
        priority: defect.severity === "BEFORE_CHECK_IN" ? "HIGH" : null,
      });
      await ctx.db.defect.update({ where: { id: defect.id }, data: { taskId: task.id } });
      return { taskId: task.id };
    }),

  /** Fixed without a task — the person on site sorted it. */
  markFixed: protectedProcedure.input(z.object({ id: z.string() })).mutation(async ({ ctx, input }) => {
    await ctx.db.defect.update({ where: { id: input.id }, data: { status: "FIXED", fixedAt: new Date() } });
  }),

  /**
   * Checked on the apartment: fixed (it no longer stops the check-in) or not
   * (to fix again — a new task can be made; the old one stays done).
   */
  check: protectedProcedure.input(z.object({ id: z.string(), fixed: z.boolean() })).mutation(async ({ ctx, input }) => {
    const defect = await ctx.db.defect.update({
      where: { id: input.id },
      data: input.fixed ? { status: "CHECKED", checkedAt: new Date(), checkedById: ctx.session.user.id } : { status: "OPEN", fixedAt: null, taskId: null },
      select: { eventId: true, slotId: true },
    });
    const latest = await ctx.db.inspection.findFirst({ where: { eventId: defect.eventId, slotId: defect.slotId }, orderBy: { createdAt: "desc" }, select: { status: true } });
    const defects = await ctx.db.defect.findMany({ where: { eventId: defect.eventId, slotId: defect.slotId }, select: { severity: true, status: true } });
    return { readiness: readinessOf(latest, defects) };
  }),
});
