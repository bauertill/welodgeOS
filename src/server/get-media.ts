import type { Prisma } from "generated/prisma";

import { taskStatusLabels } from "~/lib/tasks";
import { logAudit } from "~/server/audit";
import { notify } from "~/server/notify";

/**
 * The get media task (doc §4.11): clients have to see what a property looks
 * like, so a rate card is not shared while a property on it has no media —
 * no YouTube video, no Dropbox photos folder, no photos picked for clients.
 * Putting such a property on a card makes a task, for the request's account
 * manager, to get its photos or video; adding them on its Media tab closes it.
 */
export const GET_MEDIA = "Get media";

/** A property's media, as far as a rate card is concerned: a video, a photos folder or a photo. */
export const withMedia = { videoUrl: true, photosUrl: true, _count: { select: { photos: true } } } as const;
export const hasMedia = (property: { videoUrl: string | null; photosUrl: string | null; _count: { photos: number } }) =>
  Boolean(property.videoUrl?.trim() || property.photosUrl?.trim() || property._count.photos > 0);

export async function ensureGetMediaTask(
  tx: Prisma.TransactionClient,
  /** A request's card, or — for a general card (doc §4.11, 2026-10-26) — the event's. */
  input: { propertyId: string; salesRequestId: string | null; eventId?: string | null; actorId: string },
) {
  // One open task per property, whatever card or request asks for it.
  const open = await tx.task.findFirst({
    where: { propertyId: input.propertyId, status: { not: "DONE" }, type: { name: GET_MEDIA } },
    select: { id: true },
  });
  if (open) return null;

  const [property, request] = await Promise.all([
    tx.property.findUniqueOrThrow({ where: { id: input.propertyId }, select: { name: true } }),
    input.salesRequestId
      ? tx.salesRequest.findUniqueOrThrow({
          where: { id: input.salesRequestId },
          select: { ownerId: true, clientId: true, eventId: true, client: { select: { name: true } } },
        })
      : null,
  ]);
  const forWhom = request ? `for ${request.client.name}` : "for clients of the event";
  const type =
    (await tx.taskType.findFirst({ where: { name: { equals: GET_MEDIA, mode: "insensitive" } } })) ??
    (await tx.taskType.create({ data: { name: GET_MEDIA } }));
  const assignee = request?.ownerId ?? input.actorId;
  const task = await tx.task.create({
    data: {
      title: `Get media for ${property.name}`,
      details: [
        `${property.name} is on a rate card ${forWhom}, and the card cannot be shared until the client can see what it looks like.`,
        "Get its photos or a video, and put them on the property's Media tab:",
        "• the Dropbox folder with the photos, and the best few picked for clients",
        "• or a YouTube video",
        "This task closes on its own once they are in.",
      ].join("\n"),
      status: "TODO",
      typeId: type.id,
      requestedById: input.actorId,
      createdById: input.actorId,
      eventId: request?.eventId ?? input.eventId ?? null,
      propertyId: input.propertyId,
      clientId: request?.clientId ?? null,
      salesRequestId: input.salesRequestId,
      assignees: { connect: [{ id: assignee }] },
    },
  });
  await logAudit(tx, {
    actorId: input.actorId,
    entity: "Task",
    entityId: task.id,
    summary: `Task added: ${task.title}`,
    changes: "Made on its own when the property was put on a rate card with no photos or video",
  });
  await notify(tx, {
    to: [assignee],
    actorId: input.actorId,
    kind: "TASK_ASSIGNED",
    title: `Get media for ${property.name}`,
    body: `It is on a rate card ${forWhom}, which cannot be shared until it has photos or a video.`,
    link: `/tasks/${task.id}`,
    taskId: task.id,
  });
  return task;
}

/** The property has media now: its open get media tasks are done (doc §4.11). */
export async function closeGetMediaTasks(tx: Prisma.TransactionClient, input: { propertyId: string; actorId: string }) {
  const property = await tx.property.findUniqueOrThrow({ where: { id: input.propertyId }, select: withMedia });
  if (!hasMedia(property)) return;
  const tasks = await tx.task.findMany({
    where: { propertyId: input.propertyId, status: { not: "DONE" }, type: { name: GET_MEDIA } },
    select: { id: true, status: true },
  });
  for (const task of tasks) {
    await tx.task.update({ where: { id: task.id }, data: { status: "DONE", doneAt: new Date() } });
    await logAudit(tx, {
      actorId: input.actorId,
      entity: "Task",
      entityId: task.id,
      summary: "Done — the property has its media now",
      changes: `Status: ${taskStatusLabels[task.status]} → ${taskStatusLabels.DONE}`,
    });
  }
}
