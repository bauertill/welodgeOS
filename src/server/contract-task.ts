import type { Prisma } from "generated/prisma";

import { formatMoney, formatRange } from "~/lib/format";
import { logAudit } from "~/server/audit";
import { notify } from "~/server/notify";

/**
 * The contract task (doc §4.11, the owner's name for it, 2026-10-14): the
 * client said on a rate card which rooms they are interested in, so we put
 * an offer together — the account manager's task, with what they chose. It
 * goes in progress once the offer is made and is done once the client has
 * signed (or Volki has vouched for them); the hotels' acquire tasks follow.
 */
export const CONTRACT = "Contract";

export async function ensureContractTask(
  tx: Prisma.TransactionClient,
  input: {
    salesRequestId: string;
    /** Who made the rate card — for the task when the request has no account manager. */
    cardMadeById: string | null;
    items: { propertyName: string; roomName: string; rooms: number; checkIn: Date | null; checkOut: Date | null; sellingCents: number | null }[];
    currency: string;
  },
) {
  const request = await tx.salesRequest.findUniqueOrThrow({
    where: { id: input.salesRequestId },
    select: { clientId: true, eventId: true, ownerId: true, client: { select: { name: true } }, event: { select: { name: true } } },
  });
  const wanted = input.items.map(
    (item) =>
      `• ${item.rooms} × ${item.roomName} at ${item.propertyName}${item.checkIn && item.checkOut ? `, ${formatRange(item.checkIn, item.checkOut)}` : ""}${item.sellingCents !== null ? ` — ${formatMoney(item.sellingCents, input.currency)} a night` : ""}`,
  );
  // One open contract task per request: a later answer is added to it.
  const open = await tx.task.findFirst({
    where: { salesRequestId: input.salesRequestId, status: { not: "DONE" }, type: { name: CONTRACT } },
    select: { id: true, assignees: { select: { id: true } } },
  });
  if (open) {
    await tx.taskComment.create({ data: { taskId: open.id, authorId: null, body: `The client sent a new answer:\n${wanted.join("\n")}` } });
    return open;
  }
  const type =
    (await tx.taskType.findFirst({ where: { name: { equals: CONTRACT, mode: "insensitive" } } })) ?? (await tx.taskType.create({ data: { name: CONTRACT } }));
  const assignees = [request.ownerId ?? input.cardMadeById].filter((id): id is string => Boolean(id));
  const details = [
    `${request.client.name} is interested in:`,
    ...wanted,
    "",
    "1. Check their contracting details are in — their rate card asks for them.",
    "2. Make them an offer — the rooms are blocked for them until it runs out.",
    "3. Draw up the agreement, save it as a PDF and send it by DocuSign.",
    "4. Register it once signed, or ask Volki for the trust guarantee — the rooms are sold and the hotels' acquire tasks go out.",
  ].join("\n");
  const task = await tx.task.create({
    data: {
      title: `Contract ${request.client.name}${request.event ? ` — ${request.event.name}` : ""}`,
      details,
      status: "TODO",
      typeId: type.id,
      eventId: request.eventId,
      clientId: request.clientId,
      salesRequestId: input.salesRequestId,
      assignees: { connect: assignees.map((id) => ({ id })) },
    },
  });
  await logAudit(tx, { actorId: null, entity: "Task", entityId: task.id, summary: `Task added: ${task.title}`, changes: "Made on its own when the client answered the rate card" });
  await notify(tx, {
    to: assignees,
    actorId: null,
    kind: "TASK_ASSIGNED",
    title: `New contract task: ${request.client.name}${request.event ? ` — ${request.event.name}` : ""}`,
    body: "The client is interested — put the offer together.",
    link: `/tasks/${task.id}`,
    taskId: task.id,
  });
  return task;
}

/** The contract task moves on with the offer: in progress once made, done once signed. */
export async function moveContractTask(tx: Prisma.TransactionClient, actorId: string, salesRequestId: string, to: "IN_PROGRESS" | "DONE", why: string) {
  const tasks = await tx.task.findMany({
    where: { salesRequestId, status: to === "DONE" ? { not: "DONE" } : { in: ["BACKLOG", "TODO"] }, type: { name: CONTRACT } },
    select: { id: true },
  });
  for (const task of tasks) {
    await tx.task.update({ where: { id: task.id }, data: { status: to, doneAt: to === "DONE" ? new Date() : null } });
    await logAudit(tx, { actorId, entity: "Task", entityId: task.id, summary: `${to === "DONE" ? "Done" : "In progress"} — ${why}` });
  }
}
