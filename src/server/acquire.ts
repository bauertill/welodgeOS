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
