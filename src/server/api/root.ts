import { amenityRouter } from "~/server/api/routers/amenity";
import { clientRouter } from "~/server/api/routers/client";
import { eventRouter } from "~/server/api/routers/event";
import { inventoryRouter } from "~/server/api/routers/inventory";
import { propertyRouter } from "~/server/api/routers/property";
import { reportingRouter } from "~/server/api/routers/reporting";
import { scoutingRouter } from "~/server/api/routers/scouting";
import { userRouter } from "~/server/api/routers/user";
import { createCallerFactory, createTRPCRouter } from "~/server/api/trpc";

/**
 * The primary router. Phases 1 and 2 — operations routers arrive with Phase 3,
 * alongside §6 of docs/product-scope.md.
 */
export const appRouter = createTRPCRouter({
  event: eventRouter,
  property: propertyRouter,
  scouting: scoutingRouter,
  amenity: amenityRouter,
  clients: clientRouter,
  inventory: inventoryRouter,
  reporting: reportingRouter,
  user: userRouter,
});

export type AppRouter = typeof appRouter;

/**
 * Create a server-side caller for the tRPC API.
 * @example
 * const trpc = createCaller(createContext);
 * const res = await trpc.event.list();
 */
export const createCaller = createCallerFactory(appRouter);
