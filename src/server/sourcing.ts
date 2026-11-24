import type { Prisma } from "generated/prisma";

import { formatDate, formatMoney, formatRange } from "~/lib/format";
import { locationName, peopleWords, wishesInWords } from "~/lib/needs";
import { logAudit } from "~/server/audit";
import { notify } from "~/server/notify";

/**
 * The sourcing tasks (doc §4.11): once a request is a sales request — its
 * details in — and is for one of our events, a task to find accommodation
 * goes on the task board for **each location** the client needs rooms in, to
 * the event's accommodation managers, asked by its project lead, who is told
 * of the new request. Made when the details first come in, when a location is
 * added, or when the event is chosen after. All locations are still one
 * request, contracted under one agreement.
 */
export async function ensureSourcingTask(tx: Prisma.TransactionClient, requestId: string, actorId: string | null) {
  const request = await tx.salesRequest.findUniqueOrThrow({
    where: { id: requestId },
    include: {
      client: { select: { id: true, name: true } },
      event: { select: { id: true, name: true, projectLeadId: true, accommodationManagers: { select: { id: true } } } },
      locations: {
        orderBy: { position: "asc" },
        include: {
          lines: { orderBy: { position: "asc" } },
          closeTo: { select: { name: true } },
          points: { select: { label: true } },
        },
      },
      tasks: { select: { id: true, salesLocationId: true, type: { select: { name: true } } } },
    },
  });
  if (!request.detailedAt || !request.event) return [];
  const event = request.event;
  const sourcing = request.tasks.filter((task) => task.type?.name === SOURCING);
  const done = new Set(sourcing.map((task) => task.salesLocationId));
  const firstEver = sourcing.length === 0;
  // A request from before locations has one task with none: it stands for its first location.
  const missing = request.locations.filter((location, index) => !done.has(location.id) && !(index === 0 && sourcing.length > 0 && sourcing.every((task) => !task.salesLocationId)));
  if (missing.length === 0) return [];

  const type =
    (await tx.taskType.findFirst({ where: { name: { equals: SOURCING, mode: "insensitive" } } })) ??
    (await tx.taskType.create({ data: { name: SOURCING } }));
  const managers = event.accommodationManagers.map((person) => person.id);
  const lead = event.projectLeadId;
  const several = request.locations.length > 1;
  const shared = [
    request.budgetCents !== null && request.budgetCurrency ? `Budget: ${formatMoney(request.budgetCents, request.budgetCurrency)}` : null,
    ...wishesInWords(request),
    request.clientComments ? `The client says: ${request.clientComments}` : null,
  ];

  const made = [];
  for (const location of missing) {
    const index = request.locations.indexOf(location);
    const name = several || location.name ? locationName(location, index) : null;
    const units = location.lines.map((line) =>
      [`${line.rooms} × ${line.roomType ?? "units"}`, peopleWords(line.people), line.checkIn && line.checkOut ? formatRange(line.checkIn, line.checkOut) : line.checkIn ? `from ${formatDate(line.checkIn)}` : null]
        .filter(Boolean)
        .join(", "),
    );
    const closeTo = [...location.closeTo.map((place) => place.name), ...location.points.map((point) => point.label), ...(index === 0 ? [request.closeToOther] : [])].filter(Boolean);
    const others = several ? request.locations.filter((one) => one !== location).map((one) => locationName(one, request.locations.indexOf(one))) : [];
    const details = [
      name ? `Location: ${name}` : null,
      ...units,
      closeTo.length ? `Close to: ${closeTo.join(", ")}` : null,
      location.notes ? `For this location: ${location.notes}` : null,
      ...shared,
      others.length ? `The same request also needs rooms at: ${others.join(", ")} — each has its own sourcing task; all go under one agreement.` : null,
    ]
      .filter(Boolean)
      .join("\n");

    const task = await tx.task.create({
      data: {
        title: `Source accommodation for ${request.client.name} — ${event.name}${name ? ` · ${name}` : ""}`,
        details: details || null,
        status: "TODO",
        typeId: type.id,
        requestedById: lead ?? request.ownerId ?? actorId,
        createdById: actorId,
        eventId: event.id,
        clientId: request.client.id,
        salesRequestId: request.id,
        salesLocationId: location.id,
        assignees: { connect: managers.map((id) => ({ id })) },
      },
    });
    made.push(task);
    await logAudit(tx, {
      actorId,
      entity: "Task",
      entityId: task.id,
      summary: `Task added: ${task.title}`,
      changes: "Made on its own when the sales request's details came in",
    });
    await logAudit(tx, {
      actorId,
      entity: "SalesRequest",
      entityId: request.id,
      summary: `Sourcing task${name ? ` for ${name}` : ""} given to the event's accommodation managers`,
    });
    await notify(tx, {
      to: managers,
      actorId: null,
      kind: "TASK_ASSIGNED",
      title: `New sourcing task: ${request.client.name} for ${event.name}${name ? ` · ${name}` : ""}`,
      body: details || null,
      link: `/tasks/${task.id}`,
      taskId: task.id,
    });
  }

  // The project lead hears once, when the request first comes in.
  if (firstEver) {
    await notify(tx, {
      to: [lead],
      actorId: null,
      kind: "SALES_NEW_REQUEST",
      title: `New sales request for ${event.name}: ${request.client.name}`,
      body: managers.length
        ? made.length > 1
          ? `${made.length} sourcing tasks — one per location — went to the event's accommodation managers.`
          : "The sourcing task went to the event's accommodation managers."
        : "No accommodation manager is set for the event — give the sourcing task to someone.",
      link: `/tasks/${made[0]!.id}`,
    });
  }
  return made;
}

export const SOURCING = "Sourcing";
