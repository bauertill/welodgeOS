import type { Prisma } from "generated/prisma";

import { formatDate, formatRange } from "~/lib/format";
import { logAudit } from "~/server/audit";
import { HOTEL_CONTACT } from "~/server/hotel-contact";
import { notify } from "~/server/notify";

/**
 * The blocking task (doc §4.8, the owner 2026-11-23: "When we block a room for
 * a client on the inventory sheet this should create a blocking task for the
 * supplier"): rooms blocked for a client on the stock sheet have to be held at
 * the hotel too. One open task per hotel, client and event — a later block
 * there is added to it as a comment. It goes to whoever has these rooms with
 * the hotel (their acquisition rep), else whoever handled the hotel's contact
 * task, else the event's accommodation managers, else the person who blocked.
 */
export const BLOCKING = "Blocking";

export async function ensureBlockTasks(
  tx: Prisma.TransactionClient,
  input: {
    actorId: string;
    eventId: string;
    clientId: string;
    salesRequestId?: string | null;
    /** Only the rooms newly blocked for this client — a block amended in place tells the hotel nothing new. */
    slotIds: string[];
    checkIn: Date;
    checkOut: Date;
    blockExpiry?: Date | null;
  },
) {
  if (!input.slotIds.length) return [];
  const [slots, event, client, nights] = await Promise.all([
    tx.roomSlot.findMany({
      where: { id: { in: input.slotIds } },
      select: { id: true, category: { select: { name: true, property: { select: { id: true, name: true } } } } },
    }),
    tx.event.findUniqueOrThrow({ where: { id: input.eventId }, select: { name: true, accommodationManagers: { select: { id: true } } } }),
    tx.client.findUniqueOrThrow({ where: { id: input.clientId }, select: { name: true } }),
    tx.roomNight.findMany({
      where: { eventId: input.eventId, slotId: { in: input.slotIds }, date: { gte: input.checkIn, lt: input.checkOut } },
      select: { slotId: true, acquisitionOwnerId: true },
    }),
  ]);

  const byProperty = new Map<string, { name: string; categories: Map<string, number>; slotIds: Set<string> }>();
  for (const slot of slots) {
    const property = slot.category.property;
    const entry = byProperty.get(property.id) ?? { name: property.name, categories: new Map(), slotIds: new Set() };
    entry.categories.set(slot.category.name, (entry.categories.get(slot.category.name) ?? 0) + 1);
    entry.slotIds.add(slot.id);
    byProperty.set(property.id, entry);
  }

  const type =
    (await tx.taskType.findFirst({ where: { name: { equals: BLOCKING, mode: "insensitive" } } })) ?? (await tx.taskType.create({ data: { name: BLOCKING } }));
  const range = formatRange(input.checkIn, input.checkOut);
  const deadline = input.blockExpiry ? `The client's deadline is ${formatDate(input.blockExpiry)}.` : null;
  const made = [];

  for (const [propertyId, entry] of byProperty) {
    const lines = [...entry.categories].map(([category, rooms]) => `• ${rooms} × ${category}, ${range}`);

    const open = await tx.task.findFirst({
      where: { propertyId, eventId: input.eventId, clientId: input.clientId, status: { not: "DONE" }, type: { name: BLOCKING }, private: false },
      select: { id: true },
    });
    if (open) {
      await tx.taskComment.create({
        data: { taskId: open.id, authorId: input.actorId, body: [`More rooms blocked for ${client.name}:`, ...lines, ...(deadline ? [deadline] : [])].join("\n") },
      });
      made.push(open);
      continue;
    }

    const owners = [...new Set(nights.filter((night) => entry.slotIds.has(night.slotId)).map((night) => night.acquisitionOwnerId))].filter(
      (id): id is string => Boolean(id),
    );
    let assignees = owners;
    if (!assignees.length) {
      const contact = await tx.task.findFirst({
        where: { propertyId, eventId: input.eventId, type: { name: HOTEL_CONTACT } },
        orderBy: { createdAt: "desc" },
        select: { assignees: { select: { id: true } } },
      });
      assignees = contact?.assignees.map((person) => person.id) ?? [];
    }
    if (!assignees.length) assignees = event.accommodationManagers.map((person) => person.id);
    if (!assignees.length) assignees = [input.actorId];

    const details = [
      `${client.name} has these rooms blocked on the stock sheet:`,
      ...lines,
      ...(deadline ? ["", deadline] : []),
      "",
      `Ask ${entry.name} to hold them for us, and note their answer here.`,
    ].join("\n");
    const task = await tx.task.create({
      data: {
        title: `Block ${entry.name} for ${client.name} — ${event.name}`,
        details,
        status: "TODO",
        typeId: type.id,
        requestedById: input.actorId,
        createdById: input.actorId,
        eventId: input.eventId,
        propertyId,
        clientId: input.clientId,
        salesRequestId: input.salesRequestId ?? null,
        assignees: { connect: assignees.map((id) => ({ id })) },
      },
    });
    await logAudit(tx, {
      actorId: input.actorId,
      entity: "Task",
      entityId: task.id,
      summary: `Task added: ${task.title}`,
      changes: "Made on its own when the rooms were blocked on the stock sheet",
    });
    await notify(tx, {
      to: assignees,
      actorId: input.actorId,
      kind: "TASK_ASSIGNED",
      title: `New blocking task: ${entry.name} for ${client.name} — ${event.name}`,
      body: "Rooms were blocked for the client. Ask the hotel to hold them.",
      link: `/tasks/${task.id}`,
      taskId: task.id,
    });
    made.push(task);
  }
  return made;
}
