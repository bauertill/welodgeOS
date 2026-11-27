import { z } from "zod";

import { parseDay } from "~/lib/dates";
import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";
import { buyForContract, contractStock, moveRoom, moveTargets } from "~/server/room-move";

/**
 * Rooms changed after the fact (doc §4.8, the owner 2026-11-27): a booking
 * moved to another room at the same property when the hotel changes the
 * numbers, and a hotel's contract matched to its nights on the stock sheet.
 */
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Give the date");

export const roomMoveRouter = createTRPCRouter({
  targets: protectedProcedure
    .input(z.object({ eventId: z.string(), slotId: z.string(), checkIn: day, checkOut: day }))
    .query(({ ctx, input }) => moveTargets(ctx.db, { ...input, checkIn: parseDay(input.checkIn), checkOut: parseDay(input.checkOut) })),

  move: protectedProcedure
    .input(z.object({ eventId: z.string(), fromSlotId: z.string(), toSlotId: z.string(), checkIn: day, checkOut: day, reason: z.string().max(500).optional() }))
    .mutation(({ ctx, input }) =>
      ctx.db.$transaction((tx) => moveRoom(tx, ctx.session.user.id, { ...input, checkIn: parseDay(input.checkIn), checkOut: parseDay(input.checkOut) }), { timeout: 30_000 }),
    ),

  contractStock: protectedProcedure.input(z.object({ contractId: z.string() })).query(({ ctx, input }) => contractStock(ctx.db, input.contractId)),

  buyForContract: protectedProcedure
    .input(
      z.object({
        contractId: z.string(),
        slotIds: z.array(z.string()).min(1, "Tick at least one room"),
        checkIn: day,
        checkOut: day,
        buyPriceCents: z.number().int().min(0).nullable(),
      }),
    )
    .mutation(({ ctx, input }) =>
      ctx.db.$transaction((tx) => buyForContract(tx, ctx.session.user.id, { ...input, checkIn: parseDay(input.checkIn), checkOut: parseDay(input.checkOut) }), {
        timeout: 60_000,
        maxWait: 10_000,
      }),
    ),
});
