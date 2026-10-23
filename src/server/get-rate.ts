import type { Prisma } from "generated/prisma";

import { nightsBetween } from "~/lib/dates";
import { formatMoney, formatRange } from "~/lib/format";
import { peopleWords } from "~/lib/needs";
import { logAudit } from "~/server/audit";
import { HOTEL_CONTACT } from "~/server/hotel-contact";
import { notify } from "~/server/notify";

/**
 * The get rate task (doc §4.11, the owner, 2026-10-18): a property near the
 * client's places that we have no rate from for this request — *Get rate* on
 * the sourcing task asks the accommodation manager to send the hotel the
 * request, or call it, with the dates and rooms wanted, and register the price
 * it gives as a quote. It closes on its own once that quote is in.
 */
export const GET_RATE = "Get rate";

export async function ensureGetRateTask(tx: Prisma.TransactionClient, input: { propertyId: string; salesRequestId: string; actorId: string }) {
  const request = await tx.salesRequest.findUniqueOrThrow({
    where: { id: input.salesRequestId },
    select: {
      clientId: true,
      eventId: true,
      budgetCents: true,
      budgetCurrency: true,
      budgetBasis: true,
      client: { select: { name: true } },
      event: { select: { name: true, accommodationManagers: { select: { id: true } } } },
      lines: { orderBy: { position: "asc" } },
    },
  });
  if (!request.eventId || !request.event) throw new Error("The request has no event.");
  const eventId = request.eventId;
  // One open get rate task per property and request.
  const open = await tx.task.findFirst({
    where: { propertyId: input.propertyId, salesRequestId: input.salesRequestId, status: { not: "DONE" }, type: { name: GET_RATE } },
    select: { id: true },
  });
  if (open) return open;

  // A quote is registered against the property on the event: it goes on the event if not there yet.
  const onEvent = await tx.scoutingEntry.findFirst({ where: { eventId, propertyId: input.propertyId }, select: { id: true } });
  if (!onEvent) await tx.scoutingEntry.create({ data: { eventId, propertyId: input.propertyId } });

  const [property, contact] = await Promise.all([
    tx.property.findUniqueOrThrow({ where: { id: input.propertyId }, select: { name: true } }),
    // Whoever has spoken to the hotel already, else the event's accommodation managers.
    tx.task.findFirst({
      where: { propertyId: input.propertyId, eventId, type: { name: HOTEL_CONTACT } },
      orderBy: { createdAt: "desc" },
      select: { assignees: { select: { id: true } } },
    }),
  ]);
  const assignees = contact?.assignees.length
    ? contact.assignees.map((person) => person.id)
    : request.event.accommodationManagers.length
      ? request.event.accommodationManagers.map((person) => person.id)
      : [input.actorId];
  const type =
    (await tx.taskType.findFirst({ where: { name: { equals: GET_RATE, mode: "insensitive" } } })) ?? (await tx.taskType.create({ data: { name: GET_RATE } }));
  const wanted = request.lines.map((line) => {
    const stay = line.checkIn && line.checkOut ? `, ${formatRange(line.checkIn, line.checkOut)} (${nightsBetween(line.checkIn, line.checkOut)} nights)` : "";
    const people = peopleWords(line.people);
    return `• ${line.rooms} × ${line.roomType ?? "units"}${stay}${people ? `, ${people}` : ""}`;
  });
  const budget =
    request.budgetCents !== null && request.budgetCurrency
      ? `Their budget: ${formatMoney(request.budgetCents, request.budgetCurrency)}${request.budgetBasis === "PER_ROOM_NIGHT" ? " per room per night" : request.budgetBasis === "PER_PERSON_NIGHT" ? " per person per night" : request.budgetBasis === "TOTAL" ? " in all" : ""} — for us, not to pass on.`
      : null;
  const details = [
    `Get a price from ${property.name} for ${request.client.name}:`,
    ...(wanted.length ? wanted : ["• the rooms and dates on the request"]),
    budget,
    "",
    "Send them the request (Email the hotel, below) or call them with these dates and rooms, then register their price as a quote. This task closes on its own once the quote is in.",
  ]
    .filter((line) => line !== null)
    .join("\n");

  const task = await tx.task.create({
    data: {
      title: `Get a rate from ${property.name} for ${request.client.name} — ${request.event.name}`,
      details,
      status: "TODO",
      typeId: type.id,
      requestedById: input.actorId,
      createdById: input.actorId,
      eventId,
      propertyId: input.propertyId,
      clientId: request.clientId,
      salesRequestId: input.salesRequestId,
      assignees: { connect: assignees.map((id) => ({ id })) },
    },
  });
  await logAudit(tx, { actorId: input.actorId, entity: "Task", entityId: task.id, summary: `Task added: ${task.title}`, changes: "Asked for from the sourcing task" });
  await notify(tx, {
    to: assignees,
    actorId: input.actorId,
    kind: "TASK_ASSIGNED",
    title: `New get rate task: ${property.name} for ${request.client.name}`,
    body: "Ask the hotel for a price for the client's dates and rooms.",
    link: `/tasks/${task.id}`,
    taskId: task.id,
  });
  return task;
}
