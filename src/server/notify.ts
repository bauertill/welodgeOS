import type { NotificationKind, Prisma, PrismaClient } from "generated/prisma";

import { addDays, dayKey, today } from "~/lib/dates";
import { formatDate } from "~/lib/format";
import { openStages } from "~/lib/sales";
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
 * Only being mentioned (or tagged) is emailed (the owner, 2026-11-17: "I don't
 * want to overwhelm the team with an email every time — when they're tagged or
 * mentioned, yes"). Everything else stays in the bell.
 */
export const EMAILED_KINDS: NotificationKind[] = ["TASK_MENTION", "UPDATE_MENTION"];

/**
 * Email the mentions waiting, at once, to everyone who has not turned email
 * off. Run after every change that notifies; what fails to send is tried again
 * on the next run within the hour — never an old pile at once.
 */
export async function deliverImmediate(db: PrismaClient) {
  const waiting = await db.notification.findMany({
    where: {
      emailedAt: null,
      kind: { in: EMAILED_KINDS },
      user: { emailNotifications: { not: "NONE" } },
      createdAt: { gte: new Date(Date.now() - 60 * 60 * 1000) },
    },
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
  // Sales requests whose follow-up date has come (doc §4.11): their owner is
  // reminded once for each date set.
  const due = await db.salesRequest.findMany({
    where: { followUpOn: { lte: day }, ownerId: { not: null }, stage: { in: openStages } },
    select: { id: true, ownerId: true, followUpOn: true, nextStep: true, client: { select: { name: true } } },
  });
  for (const request of due) {
    const when = formatDate(request.followUpOn!);
    const link = `/sales/${request.id}`;
    const already = await db.notification.count({ where: { userId: request.ownerId!, kind: "SALES_FOLLOW_UP", link, body: { startsWith: `Follow up on ${when}` } } });
    if (already) continue;
    await notify(db, {
      to: [request.ownerId],
      actorId: null,
      kind: "SALES_FOLLOW_UP",
      title: `Follow up with ${request.client.name}`,
      body: `Follow up on ${when}${request.nextStep ? ` — ${request.nextStep}` : ""}`,
      link,
    });
    reminders += 1;
  }
  await deliverImmediate(db);

  // No morning summary email any more (2026-11-17): only mentions are emailed, as they happen.
  const summaries = 0;
  return { reminders, summaries };
}
