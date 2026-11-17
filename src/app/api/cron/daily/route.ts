import { env } from "~/env";
import { db } from "~/server/db";
import { syncAll } from "~/server/gmail";
import { runDaily, sendSummaries } from "~/server/notify";

/**
 * The hourly run (doc §2.9), started by Vercel's scheduler (vercel.json):
 * each person's morning summary at 7:00 their time, and once a day the
 * deadline reminders. Only Vercel can start
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
  if (new Date().getUTCHours() !== 6) return Response.json({ summaries: await sendSummaries(db) });
  const outcome = await runDaily(db);
  const emails = await syncAll(db, { budgetMs: 40_000, force: true });
  return Response.json({ ...outcome, emails });
}
