import { randomBytes } from "crypto";
import { NextResponse } from "next/server";

import { auth } from "~/server/auth";
import { consentUrl, gmailConfigured } from "~/server/gmail";
import { originOf } from "~/server/mcp/oauth";

/**
 * "Connect Gmail" on My profile (doc §4.10): off to Google, to allow WeLodge
 * OS to read this person's mail — read-only. A random state, kept in a cookie
 * for ten minutes, makes sure the answer that comes back is to this request.
 */
export async function GET(request: Request) {
  const origin = originOf(request);
  const session = await auth();
  if (!session?.user) return NextResponse.redirect(`${origin}/signin?callbackUrl=${encodeURIComponent("/team/profile")}`);
  if (!gmailConfigured()) return NextResponse.redirect(`${origin}/team/profile?gmail=not-set-up`);
  const state = randomBytes(24).toString("base64url");
  const response = NextResponse.redirect(consentUrl(origin, state, session.user.email));
  response.cookies.set("gmail-connect-state", state, { httpOnly: true, sameSite: "lax", secure: origin.startsWith("https:"), path: "/api/gmail", maxAge: 600 });
  return response;
}
