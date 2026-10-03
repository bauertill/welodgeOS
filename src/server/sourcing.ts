import type { Prisma } from "generated/prisma";

import { formatDate, formatMoney, formatRange } from "~/lib/format";
import { logAudit } from "~/server/audit";
import { notify } from "~/server/notify";

/**
 * The sourcing task (doc §4.11): once a request is a sales request — its
 * details in — and is for one of our events, a task to find accommodation
 * for it goes on the task board, to the event's accommodation managers, asked
 * by its project lead, who is told of the new request. One per request: made
 * when the details first come in, or when the event is chosen after.
 */
export async function ensureSourcingTask(tx: Prisma.TransactionClient, requestId: string, actorId: string | null) {
  const request = await tx.salesRequest.findUniqueOrThrow({
    where: { id: requestId },
    include: {
      client: { select: { id: true, name: true } },
      event: { select: { id: true, name: true, projectLeadId: true, accommodationManagers: { select: { id: true } } } },
      lines: { orderBy: { position: "asc" } },
      closeTo: { select: { name: true } },
      closeToPoints: { select: { label: true } },
      tasks: { select: { id: true, type: { select: { name: true } } } },
    },
  });
  if (!request.detailedAt || !request.event) return null;
  if (request.tasks.some((task) => task.type?.name === SOURCING)) return null;

  const type =
    (await tx.taskType.findFirst({ where: { name: { equals: SOURCING, mode: "insensitive" } } })) ??
    (await tx.taskType.create({ data: { name: SOURCING } }));
  const managers = request.event.accommodationManagers.map((person) => person.id);
  const lead = request.event.projectLeadId;
  const units = request.lines.map((line) =>
    [`${line.rooms} × ${line.roomType ?? "units"}`, line.checkIn && line.checkOut ? formatRange(line.checkIn, line.checkOut) : line.checkIn ? `from ${formatDate(line.checkIn)}` : null]
      .filter(Boolean)
      .join(", "),
  );
  const closeTo = [...request.closeTo.map((place) => place.name), ...request.closeToPoints.map((point) => point.label), request.closeToOther].filter(Boolean);
  const details = [
    ...units,
    request.budgetCents !== null && request.budgetCurrency ? `Budget: ${formatMoney(request.budgetCents, request.budgetCurrency)}` : null,
    closeTo.length ? `Close to: ${closeTo.join(", ")}` : null,
    request.clientComments ? `The client says: ${request.clientComments}` : null,
  ]
    .filter(Boolean)
    .join("\n");

  const task = await tx.task.create({
    data: {
      title: `Source accommodation for ${request.client.name} — ${request.event.name}`,
      details: details || null,
      status: "TODO",
      typeId: type.id,
      requestedById: lead ?? request.ownerId ?? actorId,
      createdById: actorId,
      eventId: request.event.id,
      clientId: request.client.id,
      salesRequestId: request.id,
      assignees: { connect: managers.map((id) => ({ id })) },
    },
  });
  await logAudit(tx, {
    actorId,
    entity: "Task",
    entityId: task.id,
    summary: `Task added: ${task.title}`,
    changes: "Made on its own when the sales request's details came in",
  });
  await logAudit(tx, { actorId, entity: "SalesRequest", entityId: request.id, summary: "Sourcing task given to the event's accommodation managers" });

  await notify(tx, {
    to: managers,
    actorId: null,
    kind: "TASK_ASSIGNED",
    title: `New sourcing task: ${request.client.name} for ${request.event.name}`,
    body: details || null,
    link: `/tasks/${task.id}`,
    taskId: task.id,
  });
  await notify(tx, {
    to: [lead],
    actorId: null,
    kind: "SALES_NEW_REQUEST",
    title: `New sales request for ${request.event.name}: ${request.client.name}`,
    body: managers.length ? "The sourcing task went to the event's accommodation managers." : "No accommodation manager is set for the event — give the sourcing task to someone.",
    link: `/tasks/${task.id}`,
  });
  return task;
}

export const SOURCING = "Sourcing";
