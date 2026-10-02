import { Priority, TaskStatus, type Prisma } from "generated/prisma";
import { TRPCError } from "@trpc/server";
import { z } from "zod";

import { priorityLabels } from "~/lib/clients";
import { parseDay } from "~/lib/dates";
import { formatDate } from "~/lib/format";
import { taskStatusLabels } from "~/lib/tasks";
import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";
import { diffFields, logAudit } from "~/server/audit";

/**
 * Tasks (doc §2.8): a board of work everyone can see — who asked for it, who
 * completes it, by when, and what it is about. Each type will get its own
 * workflow later; for now a task moves Backlog → To do → In progress → Done.
 */

const person = { select: { id: true, name: true, email: true, image: true } } as const;

const include = {
  type: { select: { id: true, name: true } },
  assignees: person,
  requestedBy: person,
  createdBy: person,
  event: { select: { id: true, name: true } },
  property: { select: { id: true, name: true } },
  client: { select: { id: true, name: true, shortName: true } },
  salesRequest: { select: { id: true, client: { select: { name: true } } } },
  _count: { select: { comments: true } },
} satisfies Prisma.TaskInclude;

const optionalDay = z.string().regex(/^(\d{4}-\d{2}-\d{2})?$/, "That date does not look right");
const blank = (value: string | undefined | null) => (value?.trim() ? value.trim() : null);

const taskInput = z.object({
  title: z.string().trim().min(1, "Say what the task is").max(300),
  details: z.string().max(10_000).optional(),
  status: z.nativeEnum(TaskStatus).optional(),
  priority: z.nativeEnum(Priority).nullable().optional(),
  deadline: optionalDay.optional(),
  typeId: z.string().nullable().optional(),
  assigneeIds: z.array(z.string()).max(50).optional(),
  requestedById: z.string().nullable().optional(),
  eventId: z.string().nullable().optional(),
  propertyId: z.string().nullable().optional(),
  clientId: z.string().nullable().optional(),
  salesRequestId: z.string().nullable().optional(),
});

type Loaded = Prisma.TaskGetPayload<{ include: typeof include }>;

/** What a task's history says about it, field by field. */
const readable = (task: Loaded) => ({
  title: task.title,
  details: task.details,
  status: taskStatusLabels[task.status],
  priority: task.priority ? priorityLabels[task.priority] : null,
  deadline: task.deadline ? formatDate(task.deadline) : null,
  type: task.type?.name ?? null,
  assignees: task.assignees.map((user) => user.name ?? user.email).join(", ") || null,
  requestedBy: task.requestedBy ? (task.requestedBy.name ?? task.requestedBy.email) : null,
  event: task.event?.name ?? null,
  property: task.property?.name ?? null,
  client: task.client?.name ?? null,
  salesRequest: task.salesRequest ? `${task.salesRequest.client.name}'s request` : null,
});
const historyFields = [
  { key: "title", label: "Task" },
  { key: "details", label: "Details" },
  { key: "status", label: "Status" },
  { key: "priority", label: "Priority" },
  { key: "deadline", label: "Deadline" },
  { key: "type", label: "Type" },
  { key: "assignees", label: "To complete" },
  { key: "requestedBy", label: "Requested by" },
  { key: "event", label: "Event" },
  { key: "property", label: "Property" },
  { key: "client", label: "Client" },
  { key: "salesRequest", label: "Sales request" },
] as const;

/** A sales request ties the task to its client and event as well, unless they were said. */
async function links(db: Prisma.TransactionClient, input: z.infer<typeof taskInput>) {
  if (!input.salesRequestId) return {};
  const request = await db.salesRequest.findUnique({ where: { id: input.salesRequestId }, select: { clientId: true, eventId: true } });
  if (!request) throw new TRPCError({ code: "NOT_FOUND", message: "That sales request no longer exists." });
  return {
    ...(input.clientId === undefined || input.clientId === null ? { clientId: request.clientId } : {}),
    ...((input.eventId === undefined || input.eventId === null) && request.eventId ? { eventId: request.eventId } : {}),
  };
}

function dataFrom(input: z.infer<typeof taskInput>) {
  return {
    ...(input.title !== undefined && { title: input.title }),
    ...(input.details !== undefined && { details: blank(input.details) }),
    ...(input.priority !== undefined && { priority: input.priority }),
    ...(input.deadline !== undefined && { deadline: input.deadline ? parseDay(input.deadline) : null }),
    ...(input.typeId !== undefined && { typeId: input.typeId }),
    ...(input.requestedById !== undefined && { requestedById: input.requestedById }),
    ...(input.eventId !== undefined && { eventId: input.eventId }),
    ...(input.propertyId !== undefined && { propertyId: input.propertyId }),
    ...(input.clientId !== undefined && { clientId: input.clientId }),
    ...(input.salesRequestId !== undefined && { salesRequestId: input.salesRequestId }),
  };
}

export const taskRouter = createTRPCRouter({
  /** The board: every task, filtered. Open ones first by deadline, then the newest. */
  list: protectedProcedure
    .input(
      z
        .object({
          search: z.string().optional(),
          status: z.nativeEnum(TaskStatus).optional(),
          assigneeId: z.string().optional(),
          requestedById: z.string().optional(),
          priority: z.nativeEnum(Priority).optional(),
          typeId: z.string().optional(),
          eventId: z.string().optional(),
          propertyId: z.string().optional(),
          clientId: z.string().optional(),
          salesRequestId: z.string().optional(),
          /** Leave out what was finished more than this many days ago. */
          doneWithinDays: z.number().int().min(1).max(3650).optional(),
        })
        .default({}),
    )
    .query(({ ctx, input }) => {
      const search = input.search?.trim();
      const doneSince = input.doneWithinDays ? new Date(Date.now() - input.doneWithinDays * 86_400_000) : null;
      return ctx.db.task.findMany({
        where: {
          status: input.status,
          priority: input.priority,
          typeId: input.typeId,
          eventId: input.eventId,
          propertyId: input.propertyId,
          clientId: input.clientId,
          salesRequestId: input.salesRequestId,
          requestedById: input.requestedById,
          ...(input.assigneeId && { assignees: { some: { id: input.assigneeId } } }),
          AND: [
            ...(search
              ? [{ OR: [{ title: { contains: search, mode: "insensitive" as const } }, { details: { contains: search, mode: "insensitive" as const } }] }]
              : []),
            ...(doneSince ? [{ OR: [{ status: { not: "DONE" as const } }, { doneAt: { gte: doneSince } }] }] : []),
          ],
        },
        include,
        orderBy: [{ deadline: { sort: "asc", nulls: "last" } }, { createdAt: "desc" }],
        take: 500,
      });
    }),

  byId: protectedProcedure.input(z.object({ id: z.string() })).query(({ ctx, input }) =>
    ctx.db.task.findUnique({ where: { id: input.id }, include }),
  ),

  /** The task types the team has named so far. */
  types: protectedProcedure.query(({ ctx }) => ctx.db.taskType.findMany({ orderBy: { name: "asc" } })),

  /** Name a new task type — or find the one already called that. */
  addType: protectedProcedure
    .input(z.object({ name: z.string().trim().min(1, "Give the type a name").max(100) }))
    .mutation(async ({ ctx, input }) => {
      const existing = await ctx.db.taskType.findFirst({ where: { name: { equals: input.name, mode: "insensitive" } } });
      return existing ?? ctx.db.taskType.create({ data: { name: input.name } });
    }),

  create: protectedProcedure.input(taskInput).mutation(({ ctx, input }) =>
    ctx.db.$transaction(async (tx) => {
      const status = input.status ?? "TODO";
      const task = await tx.task.create({
        data: {
          ...dataFrom(input),
          ...(await links(tx, input)),
          title: input.title,
          status,
          doneAt: status === "DONE" ? new Date() : null,
          // Whoever adds it asked for it, unless someone else is named.
          requestedById: input.requestedById === undefined ? ctx.session.user.id : input.requestedById,
          createdById: ctx.session.user.id,
          assignees: { connect: (input.assigneeIds ?? []).map((id) => ({ id })) },
        },
        include,
      });
      await logAudit(tx, {
        actorId: ctx.session.user.id,
        entity: "Task",
        entityId: task.id,
        summary: `Task added: ${task.title}`,
        changes: task.assignees.length ? `To complete: ${readable(task).assignees}` : null,
      });
      return task;
    }),
  ),

  /** Change a task: only the fields given. */
  update: protectedProcedure.input(taskInput.partial().extend({ id: z.string() })).mutation(({ ctx, input }) =>
    ctx.db.$transaction(async (tx) => {
      const { id, ...fields } = input;
      const before = await tx.task.findUniqueOrThrow({ where: { id }, include });
      const after = await tx.task.update({
        where: { id },
        data: {
          ...dataFrom(fields as z.infer<typeof taskInput>),
          ...(fields.salesRequestId ? await links(tx, fields as z.infer<typeof taskInput>) : {}),
          ...(fields.status !== undefined && {
            status: fields.status,
            doneAt: fields.status === "DONE" ? (before.status === "DONE" ? before.doneAt : new Date()) : null,
          }),
          ...(fields.assigneeIds !== undefined && { assignees: { set: fields.assigneeIds.map((assignee) => ({ id: assignee })) } }),
        },
        include,
      });
      const changes = diffFields(readable(before), readable(after), [...historyFields]);
      if (changes) {
        await logAudit(tx, { actorId: ctx.session.user.id, entity: "Task", entityId: id, summary: "Updated", changes });
      }
      return after;
    }),
  ),

  remove: protectedProcedure.input(z.object({ id: z.string() })).mutation(async ({ ctx, input }) => {
    const removed = await ctx.db.task.delete({ where: { id: input.id } });
    await logAudit(ctx.db, { actorId: ctx.session.user.id, entity: "Task", entityId: removed.id, summary: `Task removed: ${removed.title}` });
    return removed;
  }),

  // --- Comments --------------------------------------------------------------

  comments: protectedProcedure.input(z.object({ taskId: z.string() })).query(({ ctx, input }) =>
    ctx.db.taskComment.findMany({
      where: { taskId: input.taskId },
      orderBy: { createdAt: "desc" },
      include: { author: person },
    }),
  ),

  comment: protectedProcedure
    .input(z.object({ taskId: z.string(), body: z.string().trim().min(1, "A comment needs some text.").max(10_000) }))
    .mutation(({ ctx, input }) =>
      ctx.db.taskComment.create({
        data: { taskId: input.taskId, body: input.body, authorId: ctx.session.user.id },
        include: { author: person },
      }),
    ),

  /** Change your own comment's words; it then says it was edited. */
  editComment: protectedProcedure
    .input(z.object({ id: z.string(), body: z.string().trim().min(1, "A comment needs some text.").max(10_000) }))
    .mutation(async ({ ctx, input }) => {
      const existing = await ctx.db.taskComment.findUniqueOrThrow({ where: { id: input.id } });
      if (existing.authorId !== ctx.session.user.id) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Only the person who wrote a comment can edit it." });
      }
      if (existing.body === input.body) return existing;
      return ctx.db.taskComment.update({ where: { id: input.id }, data: { body: input.body, editedAt: new Date() } });
    }),
});
