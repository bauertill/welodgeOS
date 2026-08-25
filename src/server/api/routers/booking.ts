import { z } from "zod";

import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";

const bookingStatus = z.enum([
  "INQUIRY",
  "OPTIONED",
  "CONFIRMED",
  "CHECKED_IN",
  "CHECKED_OUT",
  "CANCELLED",
]);

/** Bookings are listed with everything the table renders, in one round trip. */
const listInclude = {
  guest: true,
  client: true,
  event: true,
  property: true,
  room: true,
} as const;

export const bookingRouter = createTRPCRouter({
  list: protectedProcedure
    .input(
      z
        .object({
          status: bookingStatus.optional(),
          eventId: z.string().optional(),
          limit: z.number().min(1).max(200).default(50),
        })
        .default({ limit: 50 }),
    )
    .query(({ ctx, input }) =>
      ctx.db.booking.findMany({
        where: { status: input.status, eventId: input.eventId },
        include: listInclude,
        orderBy: { checkIn: "asc" },
        take: input.limit,
      }),
    ),

  byId: protectedProcedure
    .input(z.object({ id: z.string() }))
    .query(({ ctx, input }) =>
      ctx.db.booking.findUnique({
        where: { id: input.id },
        include: listInclude,
      }),
    ),

  /** Counts per status, for the dashboard tiles. */
  summary: protectedProcedure.query(async ({ ctx }) => {
    const [byStatus, upcoming, guests] = await Promise.all([
      ctx.db.booking.groupBy({ by: ["status"], _count: { _all: true } }),
      ctx.db.booking.count({ where: { checkIn: { gte: new Date() } } }),
      ctx.db.guest.count(),
    ]);

    return {
      byStatus: Object.fromEntries(
        byStatus.map((row) => [row.status, row._count._all]),
      ) as Partial<Record<z.infer<typeof bookingStatus>, number>>,
      upcoming,
      guests,
      total: byStatus.reduce((sum, row) => sum + row._count._all, 0),
    };
  }),

  setStatus: protectedProcedure
    .input(z.object({ id: z.string(), status: bookingStatus }))
    .mutation(({ ctx, input }) =>
      ctx.db.booking.update({
        where: { id: input.id },
        data: { status: input.status },
      }),
    ),
});
