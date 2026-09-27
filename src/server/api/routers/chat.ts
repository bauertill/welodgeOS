import { TRPCError } from "@trpc/server";
import { z } from "zod";

import { customStatusOf, directKey, presenceOf } from "~/lib/team";
import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";
import type { db as Db } from "~/server/db";

/**
 * Internal chat (doc §2.7): private conversations between two colleagues and
 * named groups. Unlike everything else in the system, a conversation is only
 * visible to its members — every procedure here checks membership first.
 *
 * Messages are text only and, like Updates (§2.6), can be edited by their
 * author — keeping the wording they replaced — but never deleted. There is no live connection: an open conversation asks for new
 * messages every few seconds (see `threadPollMs`).
 */

const memberSelect = {
  user: {
    select: {
      id: true,
      name: true,
      email: true,
      image: true,
      lastSeenAt: true,
      status: true,
      statusUntil: true,
      customStatusEmoji: true,
      customStatusText: true,
      customStatusUntil: true,
    },
  },
} as const;

/** A member as the screen needs them: who they are, their dot and their status. */
function withPresence<
  T extends Parameters<typeof presenceOf>[0] &
    Parameters<typeof customStatusOf>[0] & { id: string; name: string | null; email: string | null; image: string | null },
>(user: T) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    image: user.image,
    presence: presenceOf(user),
    presenceUntil: presenceOf(user) === user.status ? user.statusUntil : null,
    customStatus: customStatusOf(user),
  };
}

async function requireMember(db: typeof Db, conversationId: string, userId: string) {
  const member = await db.conversationMember.findUnique({
    where: { conversationId_userId: { conversationId, userId } },
  });
  if (!member) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "This conversation does not exist, or you are not in it.",
    });
  }
  return member;
}

/** Unread messages per conversation: posted by someone else since the member last read. */
async function unreadCounts(db: typeof Db, userId: string) {
  const rows = await db.$queryRaw<{ conversationId: string; unread: bigint }[]>`
    SELECT m."conversationId", COUNT(*) AS unread
    FROM "Message" m
    JOIN "ConversationMember" cm
      ON cm."conversationId" = m."conversationId" AND cm."userId" = ${userId}
    WHERE m."createdAt" > COALESCE(cm."lastReadAt", cm."joinedAt")
      AND (m."authorId" IS NULL OR m."authorId" <> ${userId})
    GROUP BY m."conversationId"`;
  return new Map(rows.map((row) => [row.conversationId, Number(row.unread)]));
}

export const chatRouter = createTRPCRouter({
  /** My conversations, the most recently active first. */
  conversations: protectedProcedure.query(async ({ ctx }) => {
    const userId = ctx.session.user.id;
    const [conversations, unread] = await Promise.all([
      ctx.db.conversation.findMany({
        where: { members: { some: { userId } } },
        include: {
          members: { select: memberSelect },
          messages: {
            orderBy: { createdAt: "desc" },
            take: 1,
            include: { author: { select: { id: true, name: true, email: true } } },
          },
        },
      }),
      unreadCounts(ctx.db, userId),
    ]);

    return conversations
      .map((conversation) => ({
        id: conversation.id,
        name: conversation.name,
        isGroup: conversation.directKey === null,
        members: conversation.members.map((member) => withPresence(member.user)),
        lastMessage: conversation.messages[0] ?? null,
        activeAt: conversation.messages[0]?.createdAt ?? conversation.createdAt,
        unread: unread.get(conversation.id) ?? 0,
      }))
      .sort((a, b) => b.activeAt.getTime() - a.activeAt.getTime());
  }),

  /** The total for the badge in the sidebar. */
  unreadTotal: protectedProcedure.query(async ({ ctx }) => {
    const unread = await unreadCounts(ctx.db, ctx.session.user.id);
    return [...unread.values()].reduce((sum, count) => sum + count, 0);
  }),

  /** One conversation and who is in it. */
  get: protectedProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ ctx, input }) => {
      await requireMember(ctx.db, input.id, ctx.session.user.id);
      const conversation = await ctx.db.conversation.findUniqueOrThrow({
        where: { id: input.id },
        include: { members: { select: memberSelect, orderBy: { joinedAt: "asc" } } },
      });
      return {
        id: conversation.id,
        name: conversation.name,
        isGroup: conversation.directKey === null,
        members: conversation.members.map((member) => withPresence(member.user)),
      };
    }),

  /** The latest messages in a conversation, oldest first, as a chat reads. */
  messages: protectedProcedure
    .input(z.object({ conversationId: z.string() }))
    .query(async ({ ctx, input }) => {
      await requireMember(ctx.db, input.conversationId, ctx.session.user.id);
      const latest = await ctx.db.message.findMany({
        where: { conversationId: input.conversationId },
        orderBy: { createdAt: "desc" },
        take: 300,
        include: { author: { select: { id: true, name: true, email: true } } },
      });
      return latest.reverse();
    }),

  /** Open the private conversation with a colleague, starting it if need be. */
  openDirect: protectedProcedure
    .input(z.object({ userId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const me = ctx.session.user.id;
      if (input.userId === me) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "You cannot message yourself." });
      }
      await ctx.db.user.findUniqueOrThrow({ where: { id: input.userId } });
      const key = directKey(me, input.userId);
      const conversation = await ctx.db.conversation.upsert({
        where: { directKey: key },
        update: {},
        create: {
          directKey: key,
          members: { create: [{ userId: me }, { userId: input.userId }] },
        },
      });
      return { id: conversation.id };
    }),

  /** Start a named group with the chosen colleagues; the creator is always in it. */
  createGroup: protectedProcedure
    .input(
      z.object({
        name: z.string().trim().min(1, "A group needs a name.").max(80),
        memberIds: z.array(z.string()).min(1, "Choose at least one colleague."),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const ids = [...new Set([ctx.session.user.id, ...input.memberIds])];
      const conversation = await ctx.db.conversation.create({
        data: {
          name: input.name,
          members: { create: ids.map((userId) => ({ userId })) },
        },
      });
      return { id: conversation.id };
    }),

  /**
   * Add colleagues to a group. They see the whole history, including what was
   * said before they joined; only messages after joining count as unread.
   */
  addMembers: protectedProcedure
    .input(z.object({ conversationId: z.string(), userIds: z.array(z.string()).min(1) }))
    .mutation(async ({ ctx, input }) => {
      await requireMember(ctx.db, input.conversationId, ctx.session.user.id);
      const conversation = await ctx.db.conversation.findUniqueOrThrow({
        where: { id: input.conversationId },
      });
      if (conversation.directKey) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "A private conversation stays between two people. Start a group instead.",
        });
      }
      await ctx.db.conversationMember.createMany({
        data: input.userIds.map((userId) => ({ conversationId: input.conversationId, userId })),
        skipDuplicates: true,
      });
    }),

  /** Leave a group. A private conversation cannot be left. */
  leave: protectedProcedure
    .input(z.object({ conversationId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      await requireMember(ctx.db, input.conversationId, userId);
      const conversation = await ctx.db.conversation.findUniqueOrThrow({
        where: { id: input.conversationId },
      });
      if (conversation.directKey) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "A private conversation cannot be left." });
      }
      await ctx.db.conversationMember.delete({
        where: { conversationId_userId: { conversationId: input.conversationId, userId } },
      });
    }),

  send: protectedProcedure
    .input(z.object({ conversationId: z.string(), body: z.string().max(10_000) }))
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      await requireMember(ctx.db, input.conversationId, userId);
      const body = input.body.trim();
      if (!body) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "A message needs some text." });
      }
      const message = await ctx.db.message.create({
        data: { body, conversationId: input.conversationId, authorId: userId },
      });
      // Your own message is, by definition, read.
      await ctx.db.conversationMember.update({
        where: { conversationId_userId: { conversationId: input.conversationId, userId } },
        data: { lastReadAt: message.createdAt },
      });
      return message;
    }),

  /**
   * Change the text of your own message, in a conversation you are still in.
   * The wording it had is kept, and the message records when it was edited.
   * An edit is not a new message: it counts as unread for nobody.
   */
  edit: protectedProcedure
    .input(z.object({ messageId: z.string(), body: z.string().max(10_000) }))
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      const body = input.body.trim();
      if (!body) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "A message needs some text." });
      }
      const message = await ctx.db.message.findUnique({ where: { id: input.messageId } });
      if (!message) {
        throw new TRPCError({ code: "NOT_FOUND", message: "This message no longer exists." });
      }
      await requireMember(ctx.db, message.conversationId, userId);
      if (message.authorId !== userId) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Only the person who sent a message can edit it.",
        });
      }
      // Saving the same words is not an edit.
      if (body === message.body) return message;

      const [, updated] = await ctx.db.$transaction([
        ctx.db.messageRevision.create({ data: { messageId: message.id, body: message.body } }),
        ctx.db.message.update({
          where: { id: message.id },
          data: { body, editedAt: new Date() },
        }),
      ]);
      return updated;
    }),

  /** Mark everything in a conversation as read, because it is on screen. */
  markRead: protectedProcedure
    .input(z.object({ conversationId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      const member = await requireMember(ctx.db, input.conversationId, userId);
      // Read up to the newest message rather than "now": the timestamps come
      // from the database's clock, which need not agree with this server's.
      const newest = await ctx.db.message.findFirst({
        where: { conversationId: input.conversationId },
        orderBy: { createdAt: "desc" },
        select: { createdAt: true },
      });
      if (!newest || (member.lastReadAt && member.lastReadAt >= newest.createdAt)) return;
      await ctx.db.conversationMember.update({
        where: { conversationId_userId: { conversationId: input.conversationId, userId } },
        data: { lastReadAt: newest.createdAt },
      });
    }),
});
