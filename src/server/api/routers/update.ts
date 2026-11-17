import { UpdateKind } from "generated/prisma";
import { TRPCError } from "@trpc/server";
import { z } from "zod";

import { parseDay } from "~/lib/dates";
import { updateKinds } from "~/lib/update-kinds";
import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";
import { deliverImmediate, mentionedIn, notify } from "~/server/notify";

/**
 * Updates: a chronological, append-only history of meeting notes, call
 * summaries and feedback — kept on a property or a client the same way
 * `LedgerEntry` keeps inventory changes (doc §2.6). Exactly one of
 * `propertyId`/`clientId`/`salesRequestId` scopes a post. Its author can edit
 * it, which marks it as edited and keeps the wording it replaced; nobody can
 * delete one. A client's feed also shows the updates on its sales requests.
 */
const scope = z
  .object({
    propertyId: z.string().optional(),
    clientId: z.string().optional(),
    salesRequestId: z.string().optional(),
  })
  .refine((value) => [value.propertyId, value.clientId, value.salesRequestId].filter(Boolean).length === 1, {
    message: "An update belongs to exactly one property, client or sales request.",
  });

export const updateRouter = createTRPCRouter({
  list: protectedProcedure.input(scope).query(({ ctx, input }) =>
    ctx.db.update.findMany({
      where: {
        parentId: null,
        ...(input.clientId
          ? // The client's own, and those on its sales requests (doc §2.6, 2026-11-10).
            { OR: [{ clientId: input.clientId }, { salesRequest: { clientId: input.clientId } }] }
          : { propertyId: input.propertyId, salesRequestId: input.salesRequestId }),
      },
      // Replies show beneath the update they answer, oldest first (2026-11-17).
      orderBy: { createdAt: "desc" },
      include: {
        author: { select: { id: true, name: true, email: true, image: true } },
        salesRequest: { select: { id: true, event: { select: { name: true } } } },
        replies: { orderBy: { createdAt: "asc" }, include: { author: { select: { id: true, name: true, email: true, image: true } } } },
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
    .mutation(async ({ ctx, input }) => {
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
      const created = await ctx.db.update.create({
        data: {
          body,
          kind: input.kind,
          happenedOn: input.happenedOn ? parseDay(input.happenedOn) : null,
          propertyId: input.propertyId,
          clientId: input.clientId,
          salesRequestId: input.salesRequestId,
          authorId: ctx.session.user.id,
        },
        include: {
          author: { select: { id: true, name: true, email: true, image: true } },
          property: { select: { name: true } },
          client: { select: { name: true } },
          salesRequest: { select: { client: { select: { name: true } } } },
        },
      });
      // Anyone @mentioned is told — and emailed (doc §2.9, 2026-11-17).
      const mentioned = await mentionedIn(ctx.db, body);
      if (mentioned.length) {
        const where = created.property?.name ?? created.client?.name ?? created.salesRequest?.client.name ?? "an update";
        await notify(ctx.db, {
          to: mentioned,
          actorId: ctx.session.user.id,
          kind: "UPDATE_MENTION",
          title: `${ctx.session.user.name ?? "A colleague"} mentioned you on ${where}`,
          body: body.length > 300 ? `${body.slice(0, 297)}…` : body,
          link: input.propertyId ? `/properties/${input.propertyId}` : input.clientId ? `/clients/${input.clientId}` : `/sales/${input.salesRequestId}`,
        });
        await deliverImmediate(ctx.db);
      }
      return created;
    }),

  /**
   * Reply to an update (doc §2.6, the team 2026-11-17): kept on the same
   * page as the update, beneath it. Whoever wrote the update, whoever replied
   * before, and anyone @mentioned is told.
   */
  reply: protectedProcedure
    .input(z.object({ parentId: z.string(), body: z.string().max(20_000) }))
    .mutation(async ({ ctx, input }) => {
      const body = input.body.trim();
      if (!body) throw new TRPCError({ code: "BAD_REQUEST", message: "A reply needs some text." });
      const parent = await ctx.db.update.findUnique({
        where: { id: input.parentId },
        select: {
          id: true,
          parentId: true,
          authorId: true,
          propertyId: true,
          clientId: true,
          salesRequestId: true,
          replies: { select: { authorId: true } },
          property: { select: { name: true } },
          client: { select: { name: true } },
          salesRequest: { select: { client: { select: { name: true } } } },
        },
      });
      if (!parent) throw new TRPCError({ code: "NOT_FOUND", message: "This update no longer exists." });
      if (parent.parentId) throw new TRPCError({ code: "BAD_REQUEST", message: "Reply to the update itself, not to a reply." });
      const reply = await ctx.db.update.create({
        data: {
          body,
          parentId: parent.id,
          propertyId: parent.propertyId,
          clientId: parent.clientId,
          salesRequestId: parent.salesRequestId,
          authorId: ctx.session.user.id,
        },
      });
      const where = parent.property?.name ?? parent.client?.name ?? parent.salesRequest?.client.name ?? "an update";
      const mentioned = await mentionedIn(ctx.db, body);
      const link = parent.propertyId ? `/properties/${parent.propertyId}` : parent.clientId ? `/clients/${parent.clientId}` : `/sales/${parent.salesRequestId}`;
      const short = body.length > 300 ? `${body.slice(0, 297)}…` : body;
      // Mentioned: told and emailed. The writer and earlier repliers: told in the bell.
      await notify(ctx.db, { to: mentioned, actorId: ctx.session.user.id, kind: "UPDATE_MENTION", title: `${ctx.session.user.name ?? "A colleague"} mentioned you on ${where}`, body: short, link });
      await notify(ctx.db, {
        to: [parent.authorId, ...parent.replies.map((r) => r.authorId)].filter((id) => id && !mentioned.includes(id)),
        actorId: ctx.session.user.id,
        kind: "UPDATE_REPLY",
        title: `${ctx.session.user.name ?? "A colleague"} replied on ${where}`,
        body: short,
        link,
      });
      if (mentioned.length) await deliverImmediate(ctx.db);
      return reply;
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
