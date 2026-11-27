import type { Prisma } from "generated/prisma";

import { logAudit } from "~/server/audit";
import { HOTEL_CONTACT } from "~/server/hotel-contact";
import { notify } from "~/server/notify";

/**
 * The acquire task (doc §4.11, 2026-10-14): the client has signed, so the
 * rooms we sold them at a hotel now have to be secured from it. One per hotel
 * on the client's contract, tied to the sales request, the hotel and the
 * event — for whoever handled that hotel's contact task, else the event's
 * accommodation managers. It turns the hotel's quote into a contract — on the
 * hotel's agreement or ours — and closes once the hotel has signed, the rooms
 * then bought.
 */
export const ACQUIRE = "Acquire";

export async function ensureAcquireTask(
  tx: Prisma.TransactionClient,
  input: {
    salesRequestId: string;
    propertyId: string;
    eventId: string;
    actorId: string;
    /** What was sold at this hotel (the task page reads it from the request itself). */
    lines: { room: string; rooms: number; checkIn: Date; checkOut: Date; rateCents: number }[];
    currency: string;
  },
) {
  // One open acquire task per hotel and request.
  const open = await tx.task.findFirst({
    where: { propertyId: input.propertyId, salesRequestId: input.salesRequestId, status: { not: "DONE" }, type: { name: ACQUIRE } },
    select: { id: true },
  });
  if (open) return open;

  const [property, event, request, contact] = await Promise.all([
    tx.property.findUniqueOrThrow({ where: { id: input.propertyId }, select: { name: true } }),
    tx.event.findUniqueOrThrow({ where: { id: input.eventId }, select: { name: true, accommodationManagers: { select: { id: true } } } }),
    tx.salesRequest.findUniqueOrThrow({ where: { id: input.salesRequestId }, select: { clientId: true, ownerId: true, client: { select: { name: true } } } }),
    // Whoever handled the hotel already knows it and has its quote.
    tx.task.findFirst({
      where: { propertyId: input.propertyId, eventId: input.eventId, type: { name: HOTEL_CONTACT } },
      orderBy: { createdAt: "desc" },
      select: { assignees: { select: { id: true } } },
    }),
  ]);
  const type =
    (await tx.taskType.findFirst({ where: { name: { equals: ACQUIRE, mode: "insensitive" } } })) ?? (await tx.taskType.create({ data: { name: ACQUIRE } }));
  const assignees = contact?.assignees.length
    ? contact.assignees.map((person) => person.id)
    : event.accommodationManagers.length
      ? event.accommodationManagers.map((person) => person.id)
      : [input.actorId];
  // No fixed brief (the team, 2026-11-12): the task page works out what to do
  // from where the task stands, and the details are left for a colleague's notes.

  const task = await tx.task.create({
    data: {
      title: `Acquire ${property.name} for ${request.client.name} — ${event.name}`,
      status: "TODO",
      typeId: type.id,
      requestedById: request.ownerId ?? input.actorId,
      createdById: input.actorId,
      eventId: input.eventId,
      propertyId: input.propertyId,
      clientId: request.clientId,
      salesRequestId: input.salesRequestId,
      assignees: { connect: assignees.map((id) => ({ id })) },
    },
  });
  await logAudit(tx, {
    actorId: input.actorId,
    entity: "Task",
    entityId: task.id,
    summary: `Task added: ${task.title}`,
    changes: "Made on its own when the client signed",
  });
  await notify(tx, {
    to: assignees,
    actorId: input.actorId,
    kind: "TASK_ASSIGNED",
    title: `New acquire task: ${property.name} for ${request.client.name} — ${event.name}`,
    body: "The client has signed. Secure the rooms from the hotel.",
    link: `/tasks/${task.id}`,
    taskId: task.id,
  });
  return task;
}

/**
 * Acquire tasks that are done, closed on their own (the owner, 2026-11-27:
 * "if the rooms have been bought and all is clear, it should move the task to
 * completed — identify when things are done even if they are not marked").
 * An open acquire task is done once every room-night sold to its client at
 * its hotel is bought — however they were bought: the hotel signed here, a
 * quotation accepted, the contract's "On the stock sheet", or the stock sheet
 * by hand. Its history says so. Run after every change on the stock sheet
 * (only the hotels it touched) and every hour for all of them.
 */
export async function settleAcquireTasks(
  db: Prisma.TransactionClient,
  input: { eventId?: string; propertyIds?: string[]; actorId?: string | null } = {},
) {
  const tasks = await db.task.findMany({
    where: {
      status: { not: "DONE" },
      type: { name: ACQUIRE },
      salesRequestId: { not: null },
      propertyId: input.propertyIds ? { in: input.propertyIds } : { not: null },
      ...(input.eventId && { eventId: input.eventId }),
    },
    select: { id: true, salesRequestId: true, propertyId: true, eventId: true },
  });
  const closed: string[] = [];
  for (const task of tasks) {
    const where = { salesRequestId: task.salesRequestId!, salesState: "SOLD" as const, slot: { category: { propertyId: task.propertyId! } }, ...(task.eventId && { eventId: task.eventId }) };
    const [sold, open] = await Promise.all([db.roomNight.count({ where }), db.roomNight.count({ where: { ...where, acquisitionState: { not: "BOUGHT" } } })]);
    if (sold === 0 || open > 0) continue;
    await db.task.update({ where: { id: task.id }, data: { status: "DONE", doneAt: new Date() } });
    await logAudit(db, {
      actorId: input.actorId ?? null,
      entity: "Task",
      entityId: task.id,
      summary: `Done on its own — all ${sold} room-nights sold to the client at this hotel are bought`,
    });
    closed.push(task.id);
  }
  return closed;
}
