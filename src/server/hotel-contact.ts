import type { Prisma } from "generated/prisma";

import { logAudit } from "~/server/audit";
import { notify } from "~/server/notify";

/**
 * The hotel contact task (doc §4.11): once a place found while sourcing is
 * added to our properties, a task to reach out to it and gather what we need
 * — its rooms, their details, amenities, payment and cancellation terms, the
 * rate, what it includes and what comes on top — goes to the event's
 * accommodation managers (or, with none set, to whoever added it), asked by
 * whoever added it. What is gathered is
 * stored on the property and, as a quotation, on its page for the event; the
 * task shows what is in and what is still missing, read from there.
 */
export const HOTEL_CONTACT = "Hotel contact";

/** What the accommodation manager finds out, in the order it is asked. */
export const hotelContactItems = [
  { key: "categories", label: "Room categories and availability" },
  { key: "details", label: "Details per category — beds, size, sleeps" },
  { key: "amenities", label: "Amenities in general" },
  { key: "paymentTerms", label: "Payment terms" },
  { key: "cancellationTerms", label: "Cancellation terms" },
  { key: "rate", label: "Rate — as a quotation" },
  { key: "included", label: "What is included in the rate" },
  { key: "extraCosts", label: "Extra costs" },
] as const;

export async function ensureHotelContactTask(
  tx: Prisma.TransactionClient,
  input: { propertyId: string; eventId: string; salesRequestId: string | null; actorId: string },
) {
  // One open task per property and event: adding it again makes no second.
  const open = await tx.task.findFirst({
    where: { propertyId: input.propertyId, eventId: input.eventId, status: { not: "DONE" }, type: { name: HOTEL_CONTACT } },
    select: { id: true },
  });
  if (open) return null;

  const [property, event, request] = await Promise.all([
    tx.property.findUniqueOrThrow({ where: { id: input.propertyId }, select: { name: true } }),
    tx.event.findUniqueOrThrow({ where: { id: input.eventId }, select: { name: true, accommodationManagers: { select: { id: true } } } }),
    input.salesRequestId
      ? tx.salesRequest.findUnique({ where: { id: input.salesRequestId }, select: { clientId: true, client: { select: { name: true } } } })
      : null,
  ]);
  const type =
    (await tx.taskType.findFirst({ where: { name: { equals: HOTEL_CONTACT, mode: "insensitive" } } })) ??
    (await tx.taskType.create({ data: { name: HOTEL_CONTACT } }));
  // With no accommodation manager set on the event, it is for whoever added the property.
  const managers = event.accommodationManagers.length ? event.accommodationManagers.map((person) => person.id) : [input.actorId];
  const details = [
    `Reach out to ${property.name} and find out:`,
    ...hotelContactItems.map((item) => `• ${item.label}`),
    request ? `Found while sourcing for ${request.client.name}.` : null,
  ]
    .filter(Boolean)
    .join("\n");

  const task = await tx.task.create({
    data: {
      title: `Contact ${property.name} — ${event.name}`,
      details,
      status: "TODO",
      typeId: type.id,
      requestedById: input.actorId,
      createdById: input.actorId,
      eventId: input.eventId,
      propertyId: input.propertyId,
      clientId: request?.clientId ?? null,
      salesRequestId: input.salesRequestId,
      assignees: { connect: managers.map((id) => ({ id })) },
    },
  });
  await logAudit(tx, {
    actorId: input.actorId,
    entity: "Task",
    entityId: task.id,
    summary: `Task added: ${task.title}`,
    changes: "Made on its own when the property was added to the properties board",
  });
  await notify(tx, {
    to: managers,
    actorId: input.actorId,
    kind: "TASK_ASSIGNED",
    title: `New hotel contact task: ${property.name} for ${event.name}`,
    body: "Reach out to the property and gather its rooms, terms and rate.",
    link: `/tasks/${task.id}`,
    taskId: task.id,
  });
  return task;
}
