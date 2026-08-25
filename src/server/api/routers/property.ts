import { z } from "zod";

import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";

export const propertyRouter = createTRPCRouter({
  list: protectedProcedure
    .input(z.object({ eventId: z.string().optional() }).default({}))
    .query(({ ctx, input }) =>
      ctx.db.property.findMany({
        where: { eventId: input.eventId },
        orderBy: { name: "asc" },
        include: { event: true, rooms: true, _count: { select: { bookings: true } } },
      }),
    ),
});
