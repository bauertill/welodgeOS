import { z } from "zod";

import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";

export const guestRouter = createTRPCRouter({
  list: protectedProcedure
    .input(z.object({ search: z.string().optional() }).default({}))
    .query(({ ctx, input }) =>
      ctx.db.guest.findMany({
        where: input.search
          ? {
              OR: [
                { lastName: { contains: input.search, mode: "insensitive" } },
                { firstName: { contains: input.search, mode: "insensitive" } },
                { email: { contains: input.search, mode: "insensitive" } },
              ],
            }
          : undefined,
        orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
        include: { _count: { select: { bookings: true } } },
        take: 100,
      }),
    ),
});
