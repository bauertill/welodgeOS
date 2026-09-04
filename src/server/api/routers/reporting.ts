import { z } from "zod";
import type { PrismaClient } from "generated/prisma";

import {
  availability,
  deadlines,
  exposure,
  financials,
  positionByNight,
  summarise,
} from "~/lib/reporting";
import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";
import { flatten, nightInclude } from "~/server/inventory";

/**
 * The derived views of §5 and the money of §7. Every figure is computed from
 * the room-nights on read — nothing here is stored, so a report cannot drift
 * from the position it describes.
 */

const scope = z.object({
  eventId: z.string(),
  propertyId: z.string().optional(),
  categoryId: z.string().optional(),
  clientId: z.string().optional(),
});

type Scope = z.infer<typeof scope>;

/** Every report reads the same nights through the same filter. */
async function load(db: PrismaClient, input: Scope) {
  const nights = await db.roomNight.findMany({
    where: {
      eventId: input.eventId,
      slot: {
        categoryId: input.categoryId,
        category: { propertyId: input.propertyId },
      },
      ...(input.clientId
        ? {
            OR: [
              { clientId: input.clientId },
              { requests: { some: { clientId: input.clientId } } },
            ],
          }
        : {}),
    },
    include: nightInclude,
    orderBy: [{ slotId: "asc" }, { date: "asc" }],
  });
  return nights.map(flatten);
}

export const reportingRouter = createTRPCRouter({
  /** The headline numbers: what we hold, what we promised, where we are exposed. */
  summary: protectedProcedure
    .input(scope)
    .query(async ({ ctx, input }) => summarise(await load(ctx.db, input))),

  /** §5.1 — counts and net position for every (property, category, night). */
  position: protectedProcedure
    .input(scope)
    .query(async ({ ctx, input }) => positionByNight(await load(ctx.db, input))),

  /** §5.2 — every night where the sales position is stronger than the supply. */
  exposure: protectedProcedure
    .input(scope)
    .query(async ({ ctx, input }) => exposure(await load(ctx.db, input))),

  /**
   * §5.3 — what a rep can still offer. Two figures on purpose: the optimistic
   * one that assumes blocks lapse, and the conservative one that does not.
   */
  availability: protectedProcedure
    .input(
      scope.extend({
        checkIn: z.date().optional(),
        checkOut: z.date().optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const nights = await load(ctx.db, input);
      const window =
        input.checkIn && input.checkOut
          ? { checkIn: input.checkIn, checkOut: input.checkOut }
          : undefined;
      return availability(nights, window);
    }),

  /** §4.6 — everything expiring, soonest first, with the value at stake. */
  deadlines: protectedProcedure
    .input(scope)
    .query(async ({ ctx, input }) => deadlines(await load(ctx.db, input))),

  /** §7 — committed cost, contracted revenue, margin, cost at risk, idle cost. */
  financials: protectedProcedure
    .input(scope)
    .query(async ({ ctx, input }) => financials(await load(ctx.db, input))),
});
