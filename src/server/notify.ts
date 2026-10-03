import type { NotificationKind, Prisma, PrismaClient } from "generated/prisma";

import { addDays, dayKey, today } from "~/lib/dates";
import { formatDate } from "~/lib/format";
import { MENTION_PATTERN } from "~/lib/updates";
import { layoutEmail, sendEmail } from "~/server/email";

/**
 * Notifications (doc §2.9): what one person should know about, written for
 * the bell and sent by email as they chose — at once, in a daily summary, or
 * not at all. Nobody is told about what they did themselves.
 */

type Db = Prisma.TransactionClient | PrismaClient;

export async function notify(
  db: Db,
  input: { to: (string | null | undefined)[]; actorId: string | null; kind: NotificationKind; title: string; body?: string | null; link: string; taskId?: string },
) {
  const people = [...new Set(input.to.filter((id): id is string => Boolean(id)))].filter((id) => id !== input.actorId);
  if (people.length === 0) return;
  await db.notification.createMany({
    data: people.map((userId) => ({
      userId,
      actorId: input.actorId,
      kind: input.kind,
      title: input.title,
      body: input.body ?? null,
      link: input.link,
      taskId: input.taskId ?? null,
    })),
  });
}

/** The colleagues @mentioned in a text, found by the name written in it. */
export async function mentionedIn(db: Db, body: string) {
  const names = [...body.matchAll(MENTION_PATTERN)].map((match) => match[1]!.trim()).filter(Boolean);
  if (names.length === 0) return [];
  const people = await db.user.findMany({
    where: { OR: names.map((name) => ({ name: { equals: name, mode: "insensitive" as const } })) },
    select: { id: true },
  });
  return people.map((person) => person.id);
}

/** A mention as a reader sees it: "@[Ami Rossi]" → "@Ami Rossi". */
export const plainMentions = (body: string) => body.replace(MENTION_PATTERN, "@$1");

/**
 * Email what is waiting for the people who want it at once. Run after every
 * change that notifies; what fails to send stays waiting and goes next time.
 */
export async function deliverImmediate(db: PrismaClient) {
  const waiting = await db.notification.findMany({
    where: { emailedAt: null, user: { emailNotifications: "IMMEDIATE" }, createdAt: { gte: addDays(new Date(), -2) } },
    include: { user: { select: { email: true } } },
    orderBy: { createdAt: "asc" },
    take: 50,
  });
  for (const notification of waiting) {
    if (!notification.user.email) continue;
    const { text, html } = layoutEmail(notification.title, [notification]);
    const sent = await sendEmail({ to: notification.user.email, subject: notification.title, text, html });
    if (sent) await db.notification.update({ where: { id: notification.id }, data: { emailedAt: new Date() } });
  }
}

/**
 * The morning run (doc §2.9): remind about tasks due tomorrow and tasks that
 * have become overdue, then send each person who wants one their summary of
 * everything since the last.
 */
export async function runDaily(db: PrismaClient) {
  const day = today();
  const tomorrow = addDays(day, 1);
  const open = await db.task.findMany({
    where: { status: { not: "DONE" }, deadline: { not: null, lte: tomorrow } },
    select: { id: true, title: true, deadline: true, requestedById: true, assignees: { select: { id: true } } },
  });
  let reminders = 0;
  for (const task of open) {
    const deadline = task.deadline!;
    const kind: NotificationKind = dayKey(deadline) === dayKey(tomorrow) ? "TASK_DUE_SOON" : deadline < day ? "TASK_OVERDUE" : "TASK_DUE_SOON";
    if (kind === "TASK_DUE_SOON" && dayKey(deadline) === dayKey(day)) continue; // Due today: told yesterday.
    // The people completing it — or, with nobody on it yet, whoever asked.
    const people = task.assignees.length ? task.assignees.map((person) => person.id) : [task.requestedById];
    for (const userId of people) {
      if (!userId) continue;
      // Once per task and person: a day's warning, and once when it is late.
      const already = await db.notification.count({ where: { taskId: task.id, userId, kind } });
      if (already) continue;
      await notify(db, {
        to: [userId],
        actorId: null,
        kind,
        title: kind === "TASK_DUE_SOON" ? `Due tomorrow: ${task.title}` : `Overdue since ${formatDate(deadline)}: ${task.title}`,
        link: `/tasks/${task.id}`,
        taskId: task.id,
      });
      reminders += 1;
    }
  }
  await deliverImmediate(db);

  const waiting = await db.notification.findMany({
    where: { emailedAt: null, user: { emailNotifications: "DAILY" } },
    include: { user: { select: { id: true, email: true, name: true } } },
    orderBy: { createdAt: "asc" },
  });
  const byPerson = new Map<string, typeof waiting>();
  for (const notification of waiting) byPerson.set(notification.userId, [...(byPerson.get(notification.userId) ?? []), notification]);
  let summaries = 0;
  for (const items of byPerson.values()) {
    const person = items[0]!.user;
    if (!person.email) continue;
    const subject = `${items.length} ${items.length === 1 ? "thing" : "things"} for you on We Lodge OS`;
    const { text, html } = layoutEmail(`Good morning${person.name ? `, ${person.name.split(" ")[0]}` : ""} — since yesterday:`, items);
    if (await sendEmail({ to: person.email, subject, text, html })) {
      await db.notification.updateMany({ where: { id: { in: items.map((item) => item.id) } }, data: { emailedAt: new Date() } });
      summaries += 1;
    }
  }
  return { reminders, summaries };
}
