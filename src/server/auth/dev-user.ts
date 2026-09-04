/**
 * The identity the development sign-in bypass assumes.
 *
 * Kept out of the route handler because a Next.js route file may only export
 * HTTP methods and a handful of config fields — exporting a constant from it
 * fails the production build.
 */
export const DEV_USER = {
  email: "till@welodge.net",
  name: "Till Bauer",
} as const;
