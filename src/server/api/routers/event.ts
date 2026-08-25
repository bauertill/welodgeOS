import { z } from "zod";

import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";

export const eventRouter = createTRPCRouter({
  list: protectedProcedure.query(({ ctx }) =>
    ctx.db.event.findMany({
      orderBy: { startDate: "asc" },
      include: { _count: { select: { bookings: true, properties: true } } },
    }),
  ),

  byId: protectedProcedure
    .input(z.object({ id: z.string() }))
    .query(({ ctx, input }) =>
      ctx.db.event.findUnique({
        where: { id: input.id },
        include: { properties: { include: { rooms: true } } },
      }),
    ),
});
