import { env } from "~/env";
import { db } from "~/server/db";
import { syncAll } from "~/server/gmail";
import { sendDeadlineReminders, sendOverdueDigests } from "~/server/deadlines";
import { runDaily, sendSummaries } from "~/server/notify";
import { settleAcquireTasks } from "~/server/acquire";

/**
 * The hourly run (doc §2.9), started by Vercel's scheduler (vercel.json):
 * each person's morning summary at 7:00 their time, and once a day the
 * deadline reminders — tasks, and contracts' payments and cancellation
 * deadlines (doc §7.1) — and on Fridays at 7:00 each account manager's
 * overdue payments; every hour, acquire tasks whose rooms are all bought are
 * closed (doc §4.11). Only Vercel can start
 * it — it sends the secret only the project knows. Then every connected
 * Gmail is brought up to date (doc §4.10), within the time left.
 */
export const maxDuration = 60;

export async function GET(request: Request) {
  const secret = env.CRON_SECRET;
  const allowed = secret ? request.headers.get("authorization") === `Bearer ${secret}` : env.NODE_ENV === "development";
  if (!allowed) return new Response("Not allowed", { status: 401 });
  // Every hour since 2026-11-17, so each person's summary can come at 7:00 their time. The
  // deadline reminders and the Gmail catch-up stay once a day, at 06:00 UTC.
  const overdue = await sendOverdueDigests(db);
  // Acquire tasks whose rooms are all bought, however that happened, are done (2026-11-27).
  const acquireDone = (await settleAcquireTasks(db)).length;
  if (new Date().getUTCHours() !== 6) return Response.json({ summaries: await sendSummaries(db), overdue, acquireDone });
  // Written before runDaily, which emails them at once with the mentions.
  const deadlines = await sendDeadlineReminders(db);
  const outcome = await runDaily(db);
  const emails = await syncAll(db, { budgetMs: 40_000, force: true });
  return Response.json({ ...outcome, deadlines, overdue, emails, acquireDone });
}
