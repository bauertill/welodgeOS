import { bookingRouter } from "~/server/api/routers/booking";
import { eventRouter } from "~/server/api/routers/event";
import { guestRouter } from "~/server/api/routers/guest";
import { propertyRouter } from "~/server/api/routers/property";
import { createCallerFactory, createTRPCRouter } from "~/server/api/trpc";

/**
 * This is the primary router for your server.
 *
 * All routers added in /api/routers should be manually added here.
 */
export const appRouter = createTRPCRouter({
  booking: bookingRouter,
  event: eventRouter,
  property: propertyRouter,
  guest: guestRouter,
});

// export type definition of API
export type AppRouter = typeof appRouter;

/**
 * Create a server-side caller for the tRPC API.
 * @example
 * const trpc = createCaller(createContext);
 * const res = await trpc.booking.list();
 *       ^? Booking[]
 */
export const createCaller = createCallerFactory(appRouter);
