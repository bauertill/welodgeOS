import { PrismaAdapter } from "@auth/prisma-adapter";
import { type DefaultSession, type NextAuthConfig } from "next-auth";
import GoogleProvider from "next-auth/providers/google";
import ResendProvider from "next-auth/providers/resend";

import { env } from "~/env";
import { magicLinkEmail } from "~/server/auth/magic-link-email";
import { db } from "~/server/db";

/**
 * Module augmentation for `next-auth` types. Allows us to add custom properties to the `session`
 * object and keep type safety.
 *
 * @see https://next-auth.js.org/getting-started/typescript#module-augmentation
 */
declare module "next-auth" {
  interface Session extends DefaultSession {
    user: {
      id: string;
      // ...other properties
      // role: UserRole;
    } & DefaultSession["user"];
  }

  // interface User {
  //   // ...other properties
  //   // role: UserRole;
  // }
}

const isDev = env.NODE_ENV === "development";
const hasGoogle = Boolean(env.AUTH_GOOGLE_ID && env.AUTH_GOOGLE_SECRET);
const hasResend = Boolean(env.AUTH_RESEND_KEY);

const emailFrom = env.EMAIL_FROM ?? "We Lodge OS <onboarding@resend.dev>";

/**
 * Email magic link, delivered through Resend's HTTP API.
 *
 * With no API key — the default locally — the link is printed to the server
 * console instead, so sign-in works before mail delivery is set up.
 */
const emailProvider = ResendProvider({
  apiKey: env.AUTH_RESEND_KEY ?? "",
  from: emailFrom,
  // Links are single-use; a short life keeps a forwarded mail from being a key.
  maxAge: 15 * 60,
  sendVerificationRequest: async ({
    identifier,
    url,
  }: {
    identifier: string;
    url: string;
  }) => {
    if (!hasResend) {
      console.log(`\n[auth] Magic link for ${identifier}\n[auth] ${url}\n`);
      return;
    }

    const { html, text, subject } = magicLinkEmail({ url, email: identifier });

    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.AUTH_RESEND_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ from: emailFrom, to: identifier, subject, html, text }),
    });

    if (!response.ok) {
      // Surfaced on /signin as an error; the detail goes to the server log.
      console.error("[auth] Resend rejected the send:", await response.text());
      throw new Error("Could not send the sign-in email.");
    }
  },
});

/** Which sign-in methods are configured, for the sign-in page to render. */
export const providers = {
  google: hasGoogle,
  email: hasResend || isDev,
  /** The development bypass — see src/app/api/dev-login/route.ts. */
  devLogin: isDev,
  /**
   * True when the magic-link form will print the link to the server console
   * rather than emailing it. The sign-in page says so instead of telling
   * someone to check an inbox nothing was sent to.
   */
  emailGoesToConsole: !hasResend && isDev,
};

/**
 * Options for NextAuth.js used to configure adapters, providers, callbacks, etc.
 *
 * @see https://next-auth.js.org/configuration/options
 */
export const authConfig = {
  providers: [
    // Google Workspace is the primary sign-in for We Lodge staff.
    ...(hasGoogle ? [GoogleProvider] : []),
    // Magic link covers partners and anyone outside the Workspace tenant.
    ...(hasResend || isDev ? [emailProvider] : []),
  ],
  adapter: PrismaAdapter(db),
  pages: {
    signIn: "/signin",
    signOut: "/signout",
    verifyRequest: "/signin/check-email",
  },
  callbacks: {
    session: ({ session, user }) => ({
      ...session,
      user: {
        ...session.user,
        id: user.id,
      },
    }),
  },
} satisfies NextAuthConfig;
