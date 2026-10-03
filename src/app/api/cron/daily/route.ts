import { env } from "~/env";
import { db } from "~/server/db";
import { runDaily } from "~/server/notify";

/**
 * The morning run (doc §2.9), started by Vercel's scheduler (vercel.json):
 * deadline reminders, then each person's daily summary. Only Vercel can start
 * it — it sends the secret only the project knows.
 */
export async function GET(request: Request) {
  const secret = env.CRON_SECRET;
  const allowed = secret ? request.headers.get("authorization") === `Bearer ${secret}` : env.NODE_ENV === "development";
  if (!allowed) return new Response("Not allowed", { status: 401 });
  const outcome = await runDaily(db);
  return Response.json(outcome);
}
