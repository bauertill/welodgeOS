import { TRPCError } from "@trpc/server";
import { z } from "zod";

import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";

/**
 * Updates: a chronological, append-only history of meeting notes, call
 * summaries and feedback — kept on a property or a client the same way
 * `LedgerEntry` keeps inventory changes (doc §2.6). Exactly one of
 * `propertyId`/`clientId` scopes a post; there is no editing or deleting one
 * once it exists.
 */
const scope = z
  .object({
    propertyId: z.string().optional(),
    clientId: z.string().optional(),
  })
  .refine((value) => Boolean(value.propertyId) !== Boolean(value.clientId), {
    message: "An update belongs to exactly one property or client.",
  });

export const updateRouter = createTRPCRouter({
  list: protectedProcedure.input(scope).query(({ ctx, input }) =>
    ctx.db.update.findMany({
      where: {
        propertyId: input.propertyId,
        clientId: input.clientId,
      },
      orderBy: { createdAt: "desc" },
      include: {
        author: { select: { name: true, email: true, image: true } },
      },
    }),
  ),

  post: protectedProcedure
    .input(scope.and(z.object({ body: z.string().min(1) })))
    .mutation(({ ctx, input }) => {
      const body = input.body.trim();
      if (!body) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "An update needs some text.",
        });
      }
      return ctx.db.update.create({
        data: {
          body,
          propertyId: input.propertyId,
          clientId: input.clientId,
          authorId: ctx.session.user.id,
        },
        include: {
          author: { select: { name: true, email: true, image: true } },
        },
      });
    }),
});
