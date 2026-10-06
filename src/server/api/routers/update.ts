import { UpdateKind } from "generated/prisma";
import { TRPCError } from "@trpc/server";
import { z } from "zod";

import { parseDay } from "~/lib/dates";
import { updateKinds } from "~/lib/update-kinds";
import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";

/**
 * Updates: a chronological, append-only history of meeting notes, call
 * summaries and feedback — kept on a property or a client the same way
 * `LedgerEntry` keeps inventory changes (doc §2.6). Exactly one of
 * `propertyId`/`clientId` scopes a post. Its author can edit it, which marks
 * it as edited and keeps the wording it replaced; nobody can delete one.
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
        author: { select: { id: true, name: true, email: true, image: true } },
      },
    }),
  ),

  post: protectedProcedure
    .input(
      scope.and(
        z.object({
          body: z.string().min(1),
          kind: z.nativeEnum(UpdateKind).default("NOTE"),
          /** The day it took place, as YYYY-MM-DD; empty for a note. */
          happenedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
        }),
      ),
    )
    .mutation(({ ctx, input }) => {
      const body = input.body.trim();
      if (!body) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "An update needs some text.",
        });
      }
      if (updateKinds[input.kind].propertyOnly && !input.propertyId) {
        throw new TRPCError({ code: "BAD_REQUEST", message: `${updateKinds[input.kind].label} is for a property.` });
      }
      return ctx.db.update.create({
        data: {
          body,
          kind: input.kind,
          happenedOn: input.happenedOn ? parseDay(input.happenedOn) : null,
          propertyId: input.propertyId,
          clientId: input.clientId,
          authorId: ctx.session.user.id,
        },
        include: {
          author: { select: { id: true, name: true, email: true, image: true } },
        },
      });
    }),

  /**
   * Change the text of your own update. The wording it had is kept as a
   * revision, and the update records when it was edited, so the feed can say
   * so. Nobody can edit somebody else's.
   */
  edit: protectedProcedure
    .input(z.object({ id: z.string(), body: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const body = input.body.trim();
      if (!body) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "An update needs some text.",
        });
      }
      const existing = await ctx.db.update.findUnique({ where: { id: input.id } });
      if (!existing) {
        throw new TRPCError({ code: "NOT_FOUND", message: "This update no longer exists." });
      }
      if (existing.authorId !== ctx.session.user.id) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Only the person who wrote an update can edit it.",
        });
      }
      // Saving the same words is not an edit.
      if (body === existing.body) return existing;

      const [, updated] = await ctx.db.$transaction([
        ctx.db.updateRevision.create({
          data: { updateId: existing.id, body: existing.body },
        }),
        ctx.db.update.update({
          where: { id: existing.id },
          data: { body, editedAt: new Date() },
        }),
      ]);
      return updated;
    }),
});
