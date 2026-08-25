import { PrismaAdapter } from "@auth/prisma-adapter";
import { type DefaultSession, type NextAuthConfig } from "next-auth";
import GoogleProvider from "next-auth/providers/google";
import NodemailerProvider from "next-auth/providers/nodemailer";

import { env } from "~/env";
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
const hasSmtp = Boolean(env.EMAIL_SERVER && env.EMAIL_FROM);

/**
 * Email magic link. With SMTP configured the link is mailed; in local
 * development without SMTP it is printed to the server console instead, so
 * sign-in works before mail delivery is set up.
 *
 * Built lazily — the provider validates `server` as soon as it is constructed.
 */
const emailProvider = () =>
  NodemailerProvider({
    // The placeholder is never contacted: without SMTP we override
    // sendVerificationRequest and no transport is ever opened.
    server: env.EMAIL_SERVER ?? "smtp://localhost:1025",
    from: env.EMAIL_FROM ?? "We Lodge OS <no-reply@welodge.net>",
    // Links are single-use; a short life keeps a forwarded mail from being a key.
    maxAge: 15 * 60,
    ...(hasSmtp
      ? {}
      : {
          sendVerificationRequest: ({
            identifier,
            url,
          }: {
            identifier: string;
            url: string;
          }) => {
            console.log(`\n[auth] Magic link for ${identifier}\n[auth] ${url}\n`);
          },
        }),
  });

/** Which sign-in methods are configured, for the sign-in page to render. */
export const providers = {
  google: hasGoogle,
  email: hasSmtp || isDev,
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
    ...(hasSmtp || isDev ? [emailProvider()] : []),
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
