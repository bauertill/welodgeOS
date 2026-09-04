import { z } from "zod";

import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";

/**
 * The B2B buyers: federations, broadcasters, sponsors, event teams. Clients are
 * global rather than per-event — the same federation comes back for the next
 * Games, and "what have we sold this client, ever" is a question worth being
 * able to answer.
 */
const clientInput = z.object({
  name: z.string().min(1, "A client needs a name"),
  shortName: z.string().optional(),
  notes: z.string().optional(),
});

const blank = (value: string | undefined) =>
  value?.trim() ? value.trim() : null;

export const clientRouter = createTRPCRouter({
  list: protectedProcedure.query(({ ctx }) =>
    ctx.db.client.findMany({
      orderBy: { name: "asc" },
      include: {
        _count: { select: { roomNights: true, requests: true } },
      },
    }),
  ),

  create: protectedProcedure
    .input(clientInput)
    .mutation(({ ctx, input }) =>
      ctx.db.client.create({
        data: {
          name: input.name.trim(),
          shortName: blank(input.shortName),
          notes: blank(input.notes),
        },
      }),
    ),

  update: protectedProcedure
    .input(clientInput.extend({ id: z.string() }))
    .mutation(({ ctx, input }) =>
      ctx.db.client.update({
        where: { id: input.id },
        data: {
          name: input.name.trim(),
          shortName: blank(input.shortName),
          notes: blank(input.notes),
        },
      }),
    ),
});
