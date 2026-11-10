import { TRPCError } from "@trpc/server";
import type { Prisma, PrismaClient } from "generated/prisma";
import { z } from "zod";

import { logAudit } from "~/server/audit";
import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";
import { gmailConfigured, syncAll, syncMailbox } from "~/server/gmail";

/**
 * Client emails (doc §4.10): each person's Gmail connection, and the emails
 * with a client's contacts — on the client, on one contact, and on each of the
 * client's sales requests. Everyone signed in sees them, read-only (the
 * owner, 2026-11-10). Which client an email belongs to is worked out from its
 * addresses each time, so an email shows on a client as soon as the person is
 * one of its contacts.
 */

/** The emails with any of these addresses, newest first, each saying in whose mailbox it was found. */
async function emailsWith(db: PrismaClient, addresses: string[], viewerId: string) {
  if (addresses.length === 0) return [];
  const emails = await db.clientEmail.findMany({
    where: { addresses: { hasSome: addresses } },
    orderBy: { sentAt: "desc" },
    take: 300,
    include: { copies: { select: { gmailId: true, connection: { select: { email: true, user: { select: { id: true, name: true } } } } } } },
  });
  return emails.map(({ copies, ...email }) => ({
    ...email,
    foundIn: copies.map((copy) => ({
      name: copy.connection.user.name ?? copy.connection.email,
      // Only the mailbox's owner can open it in Gmail.
      openInGmail: copy.connection.user.id === viewerId ? `https://mail.google.com/mail/u/${encodeURIComponent(copy.connection.email)}/#all/${copy.gmailId}` : null,
    })),
  }));
}

const contactAddresses = async (db: Prisma.TransactionClient, clientId: string) =>
  [...new Set((await db.clientContact.findMany({ where: { clientId, email: { not: null } }, select: { email: true } })).map((c) => c.email!.trim().toLowerCase()))];

export const emailRouter = createTRPCRouter({
  /** My Gmail connection, on My profile. */
  mine: protectedProcedure.query(async ({ ctx }) => ({
    configured: gmailConfigured(),
    connection: await ctx.db.gmailConnection.findUnique({
      where: { userId: ctx.session.user.id },
      select: { email: true, connectedAt: true, lastSyncedAt: true, lastError: true, _count: { select: { copies: true } } },
    }),
  })),

  /** Disconnect my Gmail: nothing more is read. The emails already brought in stay, as the team's record. */
  disconnect: protectedProcedure.mutation(async ({ ctx }) => {
    const connection = await ctx.db.gmailConnection.findUnique({ where: { userId: ctx.session.user.id } });
    if (!connection) return;
    await ctx.db.gmailConnection.delete({ where: { id: connection.id } });
    await logAudit(ctx.db, { actorId: ctx.session.user.id, entity: "User", entityId: ctx.session.user.id, summary: `Gmail disconnected: ${connection.email}` });
  }),

  /** Sync my mailbox now, from My profile. */
  syncMine: protectedProcedure.mutation(async ({ ctx }) => {
    const connection = await ctx.db.gmailConnection.findUnique({ where: { userId: ctx.session.user.id }, select: { id: true } });
    if (!connection) throw new TRPCError({ code: "BAD_REQUEST", message: "Connect your Gmail first." });
    return syncMailbox(ctx.db, connection.id, Date.now() + 45_000);
  }),

  /**
   * Bring every connected mailbox up to date — what opening a client's emails
   * does, for mailboxes not synced in the last ten minutes; Sync now does all.
   */
  refresh: protectedProcedure.input(z.object({ force: z.boolean().default(false) })).mutation(({ ctx, input }) =>
    syncAll(ctx.db, { budgetMs: input.force ? 45_000 : 25_000, force: input.force }),
  ),

  /** A client's emails — all its contacts', or one contact's. */
  forClient: protectedProcedure.input(z.object({ clientId: z.string(), contactId: z.string().optional() })).query(async ({ ctx, input }) => {
    if (input.contactId) {
      const contact = await ctx.db.clientContact.findUnique({ where: { id: input.contactId }, select: { email: true, clientId: true } });
      if (!contact || contact.clientId !== input.clientId) throw new TRPCError({ code: "NOT_FOUND", message: "That contact is not this client's." });
      return emailsWith(ctx.db, contact.email ? [contact.email.trim().toLowerCase()] : [], ctx.session.user.id);
    }
    return emailsWith(ctx.db, await contactAddresses(ctx.db, input.clientId), ctx.session.user.id);
  }),

  /** The emails on a sales request: those with its client's contacts. */
  forRequest: protectedProcedure.input(z.object({ id: z.string() })).query(async ({ ctx, input }) => {
    const request = await ctx.db.salesRequest.findUniqueOrThrow({ where: { id: input.id }, select: { clientId: true } });
    return emailsWith(ctx.db, await contactAddresses(ctx.db, request.clientId), ctx.session.user.id);
  }),

  /** How many people have Gmail connected — said beside the emails, so an empty list is understood. */
  connectedCount: protectedProcedure.query(({ ctx }) => ctx.db.gmailConnection.count()),
});
