import { NextResponse } from "next/server";

import { logAudit } from "~/server/audit";
import { auth } from "~/server/auth";
import { db } from "~/server/db";
import { exchangeCode, mailboxAddress, seal, syncMailbox } from "~/server/gmail";
import { originOf } from "~/server/mcp/oauth";

/**
 * Google's answer to "Connect Gmail" (doc §4.10): the state checked, the code
 * traded for a refresh key — kept encrypted — and the mailbox's first sync
 * started (the last month), then back to My profile.
 */
export const maxDuration = 60;

export async function GET(request: Request) {
  const origin = originOf(request);
  const back = (outcome: string) => {
    const response = NextResponse.redirect(`${origin}/team/profile?gmail=${outcome}#gmail`);
    response.cookies.delete({ name: "gmail-connect-state", path: "/api/gmail" });
    return response;
  };
  const session = await auth();
  if (!session?.user) return NextResponse.redirect(`${origin}/signin`);
  const url = new URL(request.url);
  const cookie = request.headers.get("cookie")?.match(/(?:^|;\s*)gmail-connect-state=([^;]+)/)?.[1];
  if (url.searchParams.get("error")) return back("cancelled");
  if (!cookie || cookie !== url.searchParams.get("state")) return back("expired");

  try {
    const tokens = await exchangeCode(url.searchParams.get("code") ?? "", origin);
    if (!tokens.refresh_token) return back("no-key");
    const email = await mailboxAddress(tokens.access_token!);
    const connection = await db.gmailConnection.upsert({
      where: { userId: session.user.id },
      create: { userId: session.user.id, email, refreshTokenEnc: seal(tokens.refresh_token) },
      update: { email, refreshTokenEnc: seal(tokens.refresh_token), lastError: null },
    });
    await logAudit(db, { actorId: session.user.id, entity: "User", entityId: session.user.id, summary: `Gmail connected: ${email}` });
    // The first month now, within the time this answer has; the rest on the next sync.
    await syncMailbox(db, connection.id, Date.now() + 40_000);
    return back("connected");
  } catch (error) {
    console.error("[gmail] connect failed:", error);
    return back("failed");
  }
}
