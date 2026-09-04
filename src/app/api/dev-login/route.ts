import { randomUUID } from "crypto";
import { NextResponse } from "next/server";

import { env } from "~/env";
import { DEV_USER } from "~/server/auth/dev-user";
import { db } from "~/server/db";

/**
 * Development-only sign-in bypass.
 *
 * Magic links need Resend configured and Google SSO needs OAuth credentials;
 * with neither in place there is no way into the app locally. This mints a
 * database session for a fixed user and sets the session cookie by hand — the
 * same thing the Prisma adapter does after a real sign-in, minus the proof of
 * identity.
 *
 * It is a genuine authentication bypass, so it is fenced three ways: the route
 * 404s outside development, the button that calls it only renders in
 * development, and neither is reachable from a production build. Nothing here
 * may ever depend on an environment variable that could be set in production by
 * mistake.
 */

const THIRTY_DAYS = 30 * 24 * 60 * 60 * 1000;

export async function POST() {
  if (env.NODE_ENV !== "development") {
    // Indistinguishable from a route that does not exist.
    return new NextResponse("Not found", { status: 404 });
  }

  const user = await db.user.upsert({
    where: { email: DEV_USER.email },
    update: {},
    create: {
      email: DEV_USER.email,
      name: DEV_USER.name,
      // A real magic-link sign-in would set this; without it the account looks
      // half-created to anything that checks.
      emailVerified: new Date(),
    },
  });

  const sessionToken = randomUUID();
  const expires = new Date(Date.now() + THIRTY_DAYS);

  await db.session.create({
    data: { sessionToken, userId: user.id, expires },
  });

  const response = NextResponse.json({ email: user.email });

  // Auth.js reads this cookie name over http. The __Secure- prefixed variant is
  // the https one, which this route never runs under.
  response.cookies.set("authjs.session-token", sessionToken, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    expires,
  });

  return response;
}
