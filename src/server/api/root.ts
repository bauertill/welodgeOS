import { amenityRouter } from "~/server/api/routers/amenity";
import { eventRouter } from "~/server/api/routers/event";
import { propertyRouter } from "~/server/api/routers/property";
import { scoutingRouter } from "~/server/api/routers/scouting";
import { createCallerFactory, createTRPCRouter } from "~/server/api/trpc";

/**
 * The primary router. Phase 1 only — acquisition and sales routers arrive with
 * Phase 2, alongside their section of docs/product-scope.md.
 */
export const appRouter = createTRPCRouter({
  event: eventRouter,
  property: propertyRouter,
  scouting: scoutingRouter,
  amenity: amenityRouter,
});

export type AppRouter = typeof appRouter;

/**
 * Create a server-side caller for the tRPC API.
 * @example
 * const trpc = createCaller(createContext);
 * const res = await trpc.event.list();
 */
export const createCaller = createCallerFactory(appRouter);
