import { env } from "~/env";

/**
 * The identity the development sign-in bypass assumes: whoever is working on
 * the code, from their own `.env` (`DEV_USER_EMAIL`, `DEV_USER_NAME`), or Till
 * when those are not set.
 *
 * Reading these from the environment does not loosen the bypass: the route
 * refuses outside development before it looks at who to sign in as, so
 * setting them in production changes nothing.
 *
 * Kept out of the route handler because a Next.js route file may only export
 * HTTP methods and a handful of config fields — exporting a constant from it
 * fails the production build.
 */
export const DEV_USER = {
  email: env.DEV_USER_EMAIL ?? "till@welodge.net",
  name: env.DEV_USER_NAME ?? "Till Bauer",
} as const;
