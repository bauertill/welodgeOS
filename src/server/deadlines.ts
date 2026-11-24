import type { PrismaClient } from "generated/prisma";

import { addDays, dayKey, daysUntil, today } from "~/lib/dates";
import { cancellationKindLabels, contractHref, isSettled, paymentAmount, paymentStatusLabels, percent } from "~/lib/finance";
import { formatDate, formatMoney } from "~/lib/format";
import { layoutEmail, sendEmail } from "~/server/email";
import { DEFAULT_TIME_ZONE, localNow, notify, SUMMARY_HOUR } from "~/server/notify";

/**
 * Payment and cancellation deadlines (doc §7.1, the owner 2026-11-20): the
 * contract's account manager is emailed a month before, a week before and on
 * the day — the days changeable on each contract — and every Friday morning
 * gets one email of their payments that are overdue.
 */

const when = (left: number) => (left === 0 ? "today" : left === 1 ? "tomorrow" : `in ${left} days`);

const contractSelect = {
  id: true,
  name: true,
  party: true,
  ownerId: true,
  reminderDays: true,
  totalCents: true,
  taxCents: true,
  currency: true,
  paymentInstructions: true,
  eventId: true,
  event: { select: { name: true } },
  property: { select: { name: true } },
  client: { select: { name: true } },
  contractor: { select: { name: true } },
} as const;

const withWhom = (contract: { property: { name: string } | null; client: { name: string } | null; contractor: { name: string } | null }) =>
  contract.property?.name ?? contract.contractor?.name ?? contract.client?.name ?? null;
const dash = (who: string | null) => (who ? ` — ${who}` : "");

/**
 * The reminder that is due now for a deadline `left` days away: the nearest
 * of the contract's reminder days already reached — so a payment added five
 * days before it is due is reminded about once now, not three times.
 */
function dueReminder(reminderDays: number[], left: number) {
  const reached = reminderDays.filter((n) => n >= left);
  return reached.length ? Math.min(...reached) : null;
}

async function firstTime(db: PrismaClient, key: string) {
  const done = await db.deadlineReminderSent.findUnique({ where: { key } });
  return !done;
}

/**
 * The daily run: write each reminder that has come into the account
 * manager's bell, to be emailed at once (EMAILED_KINDS). Each goes once per
 * deadline, date and reminder day.
 */
export async function sendDeadlineReminders(db: PrismaClient) {
  const day = today();
  const horizon = addDays(day, 366);
  let sent = 0;

  const payments = await db.contractPayment.findMany({
    where: { dueOn: { gte: day, lte: horizon }, status: { notIn: ["PAID", "REFUND"] }, contract: { ownerId: { not: null } } },
    select: { id: true, description: true, dueOn: true, percentBasisPoints: true, amountCents: true, plusTaxes: true, status: true, contract: { select: contractSelect } },
  });
  for (const payment of payments) {
    const { contract } = payment;
    const left = daysUntil(payment.dueOn, day);
    const reminder = dueReminder(contract.reminderDays, left);
    if (reminder === null) continue;
    const key = `pay:${payment.id}:${dayKey(payment.dueOn)}:${reminder}`;
    if (!(await firstTime(db, key))) continue;
    const amount = paymentAmount(payment, contract);
    const who = withWhom(contract);
    await notify(db, {
      to: [contract.ownerId],
      actorId: null,
      kind: "PAYMENT_DUE",
      title: `Payment due ${when(left)}: ${payment.description}${dash(who)}`,
      body: [
        `${contract.name} · ${contract.event.name}`,
        `${contract.party === "SUPPLIER" ? `We pay${who ? ` ${who}` : ""}` : `${who ?? "The client"} pays us`}${amount !== null && contract.currency ? ` ${formatMoney(amount, contract.currency)}` : ""} on ${formatDate(payment.dueOn)} · ${paymentStatusLabels[payment.status]}`,
        ...(contract.paymentInstructions ? [`📌 ${contract.paymentInstructions}`] : []),
      ].join("\n"),
      link: contractHref(contract.eventId, contract.id),
    });
    await db.deadlineReminderSent.create({ data: { key } });
    sent += 1;
  }

  const cutoffs = await db.contractCancellation.findMany({
    where: { cutoffOn: { gte: day, lte: horizon }, handledOn: null, contract: { ownerId: { not: null } } },
    select: { id: true, kind: true, cutoffOn: true, percentBasisPoints: true, appliesTo: true, roomType: true, feeBasisPoints: true, remarks: true, contract: { select: contractSelect } },
  });
  for (const cutoff of cutoffs) {
    const { contract } = cutoff;
    const left = daysUntil(cutoff.cutoffOn, day);
    const reminder = dueReminder(contract.reminderDays, left);
    if (reminder === null) continue;
    const key = `cut:${cutoff.id}:${dayKey(cutoff.cutoffOn)}:${reminder}`;
    if (!(await firstTime(db, key))) continue;
    const what = [percent(cutoff.percentBasisPoints), cutoff.appliesTo, cutoff.roomType].filter(Boolean).join(" · ");
    const fee = cutoff.feeBasisPoints !== null ? `with a ${percent(cutoff.feeBasisPoints)} fee` : null;
    await notify(db, {
      to: [contract.ownerId],
      actorId: null,
      kind: "CANCELLATION_DUE",
      title: `Cancellation deadline ${when(left)}: ${cancellationKindLabels[cutoff.kind]}${dash(withWhom(contract))}`,
      body: [
        `${contract.name} · ${contract.event.name}`,
        `Deadline ${formatDate(cutoff.cutoffOn)}${what ? ` · ${what}` : ""}${fee ? ` ${fee}` : ""}`,
        ...(cutoff.remarks ? [cutoff.remarks] : []),
        "Mark it handled on the contract once it is dealt with.",
      ].join("\n"),
      link: contractHref(contract.eventId, contract.id),
    });
    await db.deadlineReminderSent.create({ data: { key } });
    sent += 1;
  }
  return sent;
}

/**
 * Every Friday at 7:00 in each person's own time: one email of the payments
 * overdue on the contracts they manage — not paid, the due date gone.
 * Nothing on a week with none; never twice on the same Friday.
 */
export async function sendOverdueDigests(db: PrismaClient, at = new Date()) {
  const people = await db.user.findMany({
    where: { email: { not: null }, emailNotifications: { not: "NONE" }, contractsManaged: { some: {} } },
    select: { id: true, email: true, name: true, timeZone: true, overdueSentAt: true },
  });
  let sent = 0;
  for (const person of people) {
    let zone = person.timeZone ?? DEFAULT_TIME_ZONE;
    try {
      localNow(zone, at);
    } catch {
      zone = DEFAULT_TIME_ZONE;
    }
    const now = localNow(zone, at);
    if (now.weekday !== "Fri" || now.hour !== SUMMARY_HOUR) continue;
    if (person.overdueSentAt && localNow(zone, person.overdueSentAt).day === now.day) continue;
    await db.user.update({ where: { id: person.id }, data: { overdueSentAt: at } });
    const overdue = await db.contractPayment.findMany({
      where: { dueOn: { lt: today() }, status: { notIn: ["PAID", "REFUND"] }, contract: { ownerId: person.id } },
      select: { id: true, description: true, dueOn: true, percentBasisPoints: true, amountCents: true, plusTaxes: true, status: true, contract: { select: contractSelect } },
      orderBy: { dueOn: "asc" },
      take: 100,
    });
    const items = overdue
      .filter((payment) => !isSettled(payment.status))
      .map((payment) => {
        const { contract } = payment;
        const amount = paymentAmount(payment, contract);
        const late = -daysUntil(payment.dueOn);
        return {
          title: `${payment.description}${dash(withWhom(contract))}`,
          body: [
            `${contract.name} · ${contract.event.name}`,
            `${contract.party === "SUPPLIER" ? "We pay" : "They pay us"}${amount !== null && contract.currency ? ` ${formatMoney(amount, contract.currency)}` : ""} · due ${formatDate(payment.dueOn)}, ${late} ${late === 1 ? "day" : "days"} ago · ${paymentStatusLabels[payment.status]}`,
            ...(contract.paymentInstructions ? [`📌 ${contract.paymentInstructions}`] : []),
          ].join("\n"),
          link: contractHref(contract.eventId, contract.id),
        };
      });
    if (!items.length) continue;
    const subject = `${items.length} overdue ${items.length === 1 ? "payment" : "payments"} on your contracts`;
    const { text, html } = layoutEmail(`Good morning${person.name ? `, ${person.name.split(" ")[0]}` : ""} — these payments are overdue. Mark each paid on its contract once it is:`, items);
    if (await sendEmail({ to: person.email!, subject, text, html })) sent += 1;
  }
  return sent;
}
