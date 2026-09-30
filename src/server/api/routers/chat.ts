import { TRPCError } from "@trpc/server";
import { z } from "zod";

import { env } from "~/env";
import { customStatusOf, directKey, presenceOf } from "~/lib/team";
import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";
import type { db as Db } from "~/server/db";

/**
 * Internal chat (doc §2.7): private conversations between two colleagues and
 * named groups. Unlike everything else in the system, a conversation is only
 * visible to its members — every procedure here checks membership first.
 *
 * A message is text, a GIF, or both, and can quote the message it answers.
 * Colleagues react with emoji, the team's own among them. Like Updates
 * (§2.6), a message can be edited by its author — keeping the wording it
 * replaced — but never deleted. There is no live connection: an open
 * conversation asks for new messages every few seconds (see `threadPollMs`).
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
        include: {
          author: { select: { id: true, name: true, email: true } },
          replyTo: {
            select: { id: true, body: true, gifUrl: true, author: { select: { id: true, name: true, email: true } } },
          },
          reactions: {
            orderBy: { createdAt: "asc" },
            select: { emoji: true, userId: true, user: { select: { name: true, email: true } } },
          },
        },
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
    .input(
      z.object({
        conversationId: z.string(),
        body: z.string().max(10_000),
        /** The message this one answers, quoted above it. */
        replyToId: z.string().optional(),
        gif: z
          .object({
            url: z.string().url().max(2000),
            width: z.number().int().min(1).max(4000),
            height: z.number().int().min(1).max(4000),
            title: z.string().max(300).optional(),
          })
          .optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      await requireMember(ctx.db, input.conversationId, userId);
      const body = input.body.trim();
      if (!body && !input.gif) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "A message needs some text." });
      }
      // Only GIPHY's own pictures: a message never points at an address someone typed in.
      if (input.gif && !isGiphyAddress(input.gif.url)) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "That GIF did not come from the GIF picker." });
      }
      if (input.replyToId) {
        const original = await ctx.db.message.findUnique({ where: { id: input.replyToId }, select: { conversationId: true } });
        if (original?.conversationId !== input.conversationId) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "You can only answer a message in this conversation." });
        }
      }
      const message = await ctx.db.message.create({
        data: {
          body,
          conversationId: input.conversationId,
          authorId: userId,
          replyToId: input.replyToId ?? null,
          ...(input.gif && {
            gifUrl: input.gif.url,
            gifWidth: input.gif.width,
            gifHeight: input.gif.height,
            gifTitle: input.gif.title?.trim() || null,
          }),
        },
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
      const message = await ctx.db.message.findUnique({ where: { id: input.messageId } });
      if (!message) {
        throw new TRPCError({ code: "NOT_FOUND", message: "This message no longer exists." });
      }
      // A GIF may stand on its own; words without one may not be emptied.
      if (!body && !message.gifUrl) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "A message needs some text." });
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

  // --- Reactions, the team's own emoji, and GIFs (doc §2.7) -------------------

  /**
   * React to a message with an emoji — or take the reaction back, if you had
   * already given that one. Anyone in the conversation can react to anything
   * in it, their own messages included.
   */
  react: protectedProcedure
    .input(z.object({ messageId: z.string(), emoji: z.string().min(1).max(64) }))
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      const message = await ctx.db.message.findUnique({ where: { id: input.messageId }, select: { conversationId: true } });
      if (!message) throw new TRPCError({ code: "NOT_FOUND", message: "This message no longer exists." });
      await requireMember(ctx.db, message.conversationId, userId);
      if (input.emoji.startsWith("custom:")) {
        const exists = await ctx.db.customEmoji.findUnique({ where: { id: input.emoji.slice("custom:".length) } });
        if (!exists) throw new TRPCError({ code: "BAD_REQUEST", message: "That emoji no longer exists." });
      } else if ([...input.emoji].length > 12 || !isEmoji(input.emoji)) {
        // An emoji is a picture, not words.
        throw new TRPCError({ code: "BAD_REQUEST", message: "Choose an emoji from the picker." });
      }
      const key = { messageId_userId_emoji: { messageId: input.messageId, userId, emoji: input.emoji } };
      const existing = await ctx.db.messageReaction.findUnique({ where: key });
      if (existing) {
        await ctx.db.messageReaction.delete({ where: key });
        return { reacted: false };
      }
      await ctx.db.messageReaction.create({ data: { messageId: input.messageId, userId, emoji: input.emoji } });
      return { reacted: true };
    }),

  /** The three emoji you react with most, for the quick row beside a message. */
  myQuickReactions: protectedProcedure.query(async ({ ctx }) => {
    const rows = await ctx.db.messageReaction.groupBy({
      by: ["emoji"],
      where: { userId: ctx.session.user.id },
      _count: { _all: true },
      orderBy: { _count: { emoji: "desc" } },
      take: 3,
    });
    const mine = rows.map((row) => row.emoji);
    // Until you have favourites of your own, everyone's usual ones.
    return [...mine, ...["👍", "❤️", "😂"].filter((emoji) => !mine.includes(emoji))].slice(0, 3);
  }),

  /** The team's own emoji, for the picker and for drawing reactions. */
  customEmoji: protectedProcedure.query(({ ctx }) =>
    ctx.db.customEmoji.findMany({
      orderBy: { name: "asc" },
      select: { id: true, name: true, image: true, createdById: true },
    }),
  ),

  /** Add an emoji of the team's own: a short name and a small picture. */
  addCustomEmoji: protectedProcedure
    .input(
      z.object({
        name: z
          .string()
          .trim()
          .toLowerCase()
          .regex(/^[a-z0-9_-]{2,32}$/, "Use 2 to 32 letters, numbers, - or _, with no spaces — like welodge or la28."),
        // Shrunk to a small square in the browser before it is sent.
        image: z
          .string()
          .max(80_000, "That picture is too large — try a simpler one.")
          .regex(/^data:image\/png;base64,[A-Za-z0-9+/=]+$/, "That is not a picture the system can use."),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const taken = await ctx.db.customEmoji.findUnique({ where: { name: input.name } });
      if (taken) throw new TRPCError({ code: "BAD_REQUEST", message: `There is already an emoji called :${input.name}:.` });
      return ctx.db.customEmoji.create({
        data: { name: input.name, image: input.image, createdById: ctx.session.user.id },
        select: { id: true, name: true, image: true, createdById: true },
      });
    }),

  /**
   * GIFs from GIPHY, searched on our server so the key stays there: trending
   * ones when nothing is typed. Only links come back; nothing is stored.
   */
  gifs: protectedProcedure
    .input(z.object({ q: z.string().max(100).default("") }))
    .query(async ({ input }) => {
      const key = env.GIPHY_API_KEY;
      if (!key) return { configured: false as const, gifs: [] };
      const q = input.q.trim();
      const url = new URL(`https://api.giphy.com/v1/gifs/${q ? "search" : "trending"}`);
      url.searchParams.set("api_key", key);
      url.searchParams.set("limit", "24");
      url.searchParams.set("rating", "pg-13");
      if (q) url.searchParams.set("q", q);
      const response = await fetch(url, { cache: "no-store" });
      if (!response.ok) {
        throw new TRPCError({ code: "BAD_GATEWAY", message: "GIPHY did not answer. Try again in a moment." });
      }
      const json = (await response.json()) as {
        data: { id: string; title: string; images: { fixed_width: { url: string; width: string; height: string } } }[];
      };
      return {
        configured: true as const,
        gifs: json.data
          .map((gif) => ({
            id: gif.id,
            title: gif.title,
            url: gif.images.fixed_width.url,
            width: Number(gif.images.fixed_width.width),
            height: Number(gif.images.fixed_width.height),
          }))
          .filter((gif) => isGiphyAddress(gif.url)),
      };
    }),
});

/** A single emoji as the picker gives it — skin tones, flags and keycaps included — and never words. */
function isEmoji(text: string) {
  return (
    /\p{Extended_Pictographic}|\p{Regional_Indicator}|\u20E3/u.test(text) &&
    /^(?:\p{Extended_Pictographic}|\p{Regional_Indicator}|\p{Emoji_Modifier}|[\uFE0F\u200D\u20E3\u{E0020}-\u{E007F}#*0-9])+$/u.test(text)
  );
}

/** GIPHY's own picture addresses, and nothing else. */
function isGiphyAddress(address: string) {
  try {
    const url = new URL(address);
    return url.protocol === "https:" && /^(media\d*|i)\.giphy\.com$/.test(url.hostname);
  } catch {
    return false;
  }
}
