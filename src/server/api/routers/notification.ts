import { EmailPreference } from "generated/prisma";
import { z } from "zod";

import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";

/** The bell (doc §2.9): your own notifications, newest first, and how you want them by email. */
export const notificationRouter = createTRPCRouter({
  mine: protectedProcedure.query(async ({ ctx }) => {
    const userId = ctx.session.user.id;
    const [items, unread] = await Promise.all([
      ctx.db.notification.findMany({
        where: { userId },
        orderBy: { createdAt: "desc" },
        take: 30,
        include: { actor: { select: { id: true, name: true, email: true } } },
      }),
      ctx.db.notification.count({ where: { userId, readAt: null } }),
    ]);
    return { items, unread };
  }),

  markRead: protectedProcedure.input(z.object({ id: z.string() })).mutation(({ ctx, input }) =>
    ctx.db.notification.updateMany({ where: { id: input.id, userId: ctx.session.user.id, readAt: null }, data: { readAt: new Date() } }),
  ),

  markAllRead: protectedProcedure.mutation(({ ctx }) =>
    ctx.db.notification.updateMany({ where: { userId: ctx.session.user.id, readAt: null }, data: { readAt: new Date() } }),
  ),

  emailPreference: protectedProcedure.query(async ({ ctx }) => {
    const me = await ctx.db.user.findUniqueOrThrow({ where: { id: ctx.session.user.id }, select: { emailNotifications: true } });
    return me.emailNotifications;
  }),

  setEmailPreference: protectedProcedure
    .input(z.object({ preference: z.nativeEnum(EmailPreference) }))
    .mutation(({ ctx, input }) =>
      ctx.db.user.update({ where: { id: ctx.session.user.id }, data: { emailNotifications: input.preference }, select: { emailNotifications: true } }),
    ),
});
