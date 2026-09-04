import { z } from "zod";

import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";

const eventInput = z.object({
  name: z.string().min(1, "An event needs a name"),
  city: z.string().optional(),
  country: z.string().optional(),
  startDate: z.date(),
  endDate: z.date(),
  status: z.enum(["PLANNING", "ACTIVE", "CLOSED"]).default("PLANNING"),
  venueName: z.string().optional(),
  venueLatitude: z.number().min(-90).max(90).optional(),
  venueLongitude: z.number().min(-180).max(180).optional(),
});

export const eventRouter = createTRPCRouter({
  list: protectedProcedure.query(({ ctx }) =>
    ctx.db.event.findMany({
      orderBy: { startDate: "asc" },
      include: { _count: { select: { scoutingEntries: true } } },
    }),
  ),

  byId: protectedProcedure
    .input(z.object({ id: z.string() }))
    .query(({ ctx, input }) =>
      ctx.db.event.findUnique({ where: { id: input.id } }),
    ),

  create: protectedProcedure
    .input(eventInput)
    .mutation(({ ctx, input }) =>
      ctx.db.event.create({
        data: {
          ...input,
          city: input.city?.trim() || null,
          country: input.country?.trim() || null,
          venueName: input.venueName?.trim() || null,
        },
      }),
    ),

  update: protectedProcedure
    .input(eventInput.extend({ id: z.string() }))
    .mutation(({ ctx, input }) => {
      const { id, ...data } = input;
      return ctx.db.event.update({ where: { id }, data });
    }),
});
