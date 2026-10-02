import { amenityRouter } from "~/server/api/routers/amenity";
import { auditRouter } from "~/server/api/routers/audit";
import { chatRouter } from "~/server/api/routers/chat";
import { clientRouter } from "~/server/api/routers/client";
import { eventRouter } from "~/server/api/routers/event";
import { financeRouter } from "~/server/api/routers/finance";
import { inventoryRouter } from "~/server/api/routers/inventory";
import { quotationRouter } from "~/server/api/routers/quotation";
import { placeRouter } from "~/server/api/routers/place";
import { propertyRouter } from "~/server/api/routers/property";
import { providerRouter } from "~/server/api/routers/provider";
import { reportingRouter } from "~/server/api/routers/reporting";
import { salesRouter } from "~/server/api/routers/sales";
import { scoutingRouter } from "~/server/api/routers/scouting";
import { taskRouter } from "~/server/api/routers/task";
import { travelRouter } from "~/server/api/routers/travel";
import { updateRouter } from "~/server/api/routers/update";
import { userRouter } from "~/server/api/routers/user";
import { createCallerFactory, createTRPCRouter } from "~/server/api/trpc";

/**
 * The primary router. Phases 1 and 2 — operations routers arrive with Phase 3,
 * alongside §6 of docs/product-scope.md.
 */
export const appRouter = createTRPCRouter({
  event: eventRouter,
  place: placeRouter,
  property: propertyRouter,
  provider: providerRouter,
  scouting: scoutingRouter,
  quotation: quotationRouter,
  amenity: amenityRouter,
  clients: clientRouter,
  sales: salesRouter,
  inventory: inventoryRouter,
  finance: financeRouter,
  reporting: reportingRouter,
  travel: travelRouter,
  user: userRouter,
  update: updateRouter,
  audit: auditRouter,
  chat: chatRouter,
  task: taskRouter,
});

export type AppRouter = typeof appRouter;

/**
 * Create a server-side caller for the tRPC API.
 * @example
 * const trpc = createCaller(createContext);
 * const res = await trpc.event.list();
 */
export const createCaller = createCallerFactory(appRouter);
