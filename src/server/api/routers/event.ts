import { z } from "zod";

import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";

const eventInput = z.object({
  name: z.string().min(1, "An event needs a name"),
  city: z.string().optional(),
  country: z.string().optional(),
  startDate: z.date(),
  endDate: z.date(),
  status: z.enum(["PLANNING", "ACTIVE", "CLOSED"]).default("PLANNING"),
});

export const eventRouter = createTRPCRouter({
  list: protectedProcedure.query(({ ctx }) =>
    ctx.db.event.findMany({
      orderBy: { startDate: "asc" },
      include: {
        // Venues are places of interest now (doc §3.7), and the list names
        // them under the event.
        placesOfInterest: {
          where: { category: "VENUE" },
          orderBy: { name: "asc" },
          select: { id: true, name: true },
        },
        _count: { select: { scoutingEntries: true, roomNights: true } },
      },
    }),
  ),

  byId: protectedProcedure
    .input(z.object({ id: z.string() }))
    .query(({ ctx, input }) =>
      ctx.db.event.findUnique({
        where: { id: input.id },
        include: {
          placesOfInterest: {
            orderBy: [{ category: "asc" }, { name: "asc" }],
          },
        },
      }),
    ),

  create: protectedProcedure
    .input(eventInput)
    .mutation(({ ctx, input }) =>
      ctx.db.event.create({
        data: {
          ...input,
          city: input.city?.trim() || null,
          country: input.country?.trim() || null,
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
