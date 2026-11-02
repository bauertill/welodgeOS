import { del } from "@vercel/blob";
import { TRPCError } from "@trpc/server";
import { randomBytes } from "crypto";
import { z } from "zod";

import { env } from "~/env";
import { companyDomain, normalEmail, websiteDomain } from "~/lib/fact-sheets";
import { logAudit } from "~/server/audit";
import { createTRPCRouter, protectedProcedure, publicProcedure } from "~/server/api/trpc";
import type { PrismaClient } from "generated/prisma";

/**
 * Fact sheets for the newsletter (doc §4.12): PDFs whose private link asks
 * for an email before handing the file over, and who downloaded what —
 * matched to our client contacts by their email when read.
 */

const newToken = () => randomBytes(18).toString("base64url");

/** Only a file in our own Blob store is taken as an upload. */
const blobUrl = z
  .string()
  .url()
  .refine((url) => new URL(url).hostname.endsWith(".blob.vercel-storage.com"), "That is not an uploaded file.");

const sheetInput = z.object({
  title: z.string().trim().min(1, "Give the fact sheet a title").max(200),
  description: z.string().max(2000).optional(),
});

const fileInput = z.union([
  z.object({ kind: z.literal("upload"), fileUrl: blobUrl, fileName: z.string().max(300), fileSize: z.number().int().min(0) }),
  z.object({ kind: z.literal("link"), linkUrl: z.string().trim().url("Paste the full link, starting with https://") }),
]);

const blank = (value: string | undefined) => (value?.trim() ? value.trim() : null);

type Reader = { client: { id: string; name: string }; contact: { id: string; name: string } | null };

/**
 * Who each email is, in the CRM (doc §4.12): a contact whose email it is —
 * else, by the email's company domain, the client whose contacts, general
 * email or website share it. Personal addresses (Gmail and the like) are
 * matched only to a contact, never by domain.
 */
async function whoAre(db: PrismaClient, emails: string[]) {
  const unique = [...new Set(emails.map(normalEmail))];
  const found = new Map<string, Reader>();
  if (!unique.length) return found;
  const contacts = await db.clientContact.findMany({
    where: { OR: unique.map((email) => ({ email: { equals: email, mode: "insensitive" as const } })) },
    select: { id: true, name: true, email: true, client: { select: { id: true, name: true } } },
    orderBy: { createdAt: "asc" },
  });
  for (const contact of contacts) {
    const email = normalEmail(contact.email!);
    if (!found.has(email)) found.set(email, { client: contact.client, contact: { id: contact.id, name: contact.name } });
  }
  const domains = new Set(unique.filter((email) => !found.has(email)).map(companyDomain).filter((domain): domain is string => Boolean(domain)));
  if (domains.size) {
    const clients = await db.client.findMany({
      select: { id: true, name: true, email: true, website: true, contacts: { select: { email: true } } },
      orderBy: { name: "asc" },
    });
    const byDomain = new Map<string, { id: string; name: string }>();
    for (const client of clients) {
      for (const domain of [companyDomain(client.email), websiteDomain(client.website), ...client.contacts.map((c) => companyDomain(c.email))]) {
        if (domain && domains.has(domain) && !byDomain.has(domain)) byDomain.set(domain, { id: client.id, name: client.name });
      }
    }
    for (const email of unique) {
      const domain = companyDomain(email);
      if (!found.has(email) && domain && byDomain.has(domain)) found.set(email, { client: byDomain.get(domain)!, contact: null });
    }
  }
  return found;
}

export const factSheetRouter = createTRPCRouter({
  /** Whether uploading is switched on — a Blob store connected (doc §4.12). */
  canUpload: protectedProcedure.query(() => Boolean(env.BLOB_READ_WRITE_TOKEN)),

  /** Every fact sheet, newest first, with how often and by how many it was downloaded. */
  list: protectedProcedure.query(async ({ ctx }) => {
    const sheets = await ctx.db.factSheet.findMany({
      orderBy: { createdAt: "desc" },
      include: { createdBy: { select: { name: true } }, downloads: { select: { email: true, createdAt: true } } },
    });
    return sheets.map(({ downloads, ...sheet }) => ({
      ...sheet,
      downloads: downloads.length,
      readers: new Set(downloads.map((download) => download.email)).size,
      lastDownload: downloads.reduce<Date | null>((last, download) => (!last || download.createdAt > last ? download.createdAt : last), null),
    }));
  }),

  /** One fact sheet, with each download and who it was in the CRM. */
  byId: protectedProcedure.input(z.object({ id: z.string() })).query(async ({ ctx, input }) => {
    const sheet = await ctx.db.factSheet.findUnique({
      where: { id: input.id },
      include: { createdBy: { select: { name: true } }, downloads: { orderBy: { createdAt: "desc" } } },
    });
    if (!sheet) return null;
    const who = await whoAre(ctx.db, sheet.downloads.map((download) => download.email));
    return {
      ...sheet,
      downloads: sheet.downloads.map((download) => ({ ...download, who: who.get(download.email) ?? null, domain: companyDomain(download.email) })),
    };
  }),

  create: protectedProcedure.input(sheetInput.extend({ file: fileInput })).mutation(async ({ ctx, input }) => {
    const sheet = await ctx.db.factSheet.create({
      data: {
        title: input.title,
        description: blank(input.description),
        ...(input.file.kind === "upload"
          ? { fileUrl: input.file.fileUrl, fileName: input.file.fileName, fileSize: input.file.fileSize }
          : { linkUrl: input.file.linkUrl }),
        token: newToken(),
        createdById: ctx.session.user.id,
      },
    });
    await logAudit(ctx.db, { actorId: ctx.session.user.id, entity: "FactSheet", entityId: sheet.id, summary: "Fact sheet added" });
    return sheet;
  }),

  /** Change the title, description or the file; an uploaded file replaced is removed from the store. */
  update: protectedProcedure.input(sheetInput.extend({ id: z.string(), file: fileInput.optional() })).mutation(async ({ ctx, input }) => {
    const before = await ctx.db.factSheet.findUniqueOrThrow({ where: { id: input.id } });
    const sheet = await ctx.db.factSheet.update({
      where: { id: input.id },
      data: {
        title: input.title,
        description: blank(input.description),
        ...(input.file &&
          (input.file.kind === "upload"
            ? { fileUrl: input.file.fileUrl, fileName: input.file.fileName, fileSize: input.file.fileSize, linkUrl: null }
            : { linkUrl: input.file.linkUrl, fileUrl: null, fileName: null, fileSize: null })),
      },
    });
    if (input.file && before.fileUrl && before.fileUrl !== sheet.fileUrl && env.BLOB_READ_WRITE_TOKEN) await del(before.fileUrl).catch(() => undefined);
    await logAudit(ctx.db, { actorId: ctx.session.user.id, entity: "FactSheet", entityId: sheet.id, summary: input.file ? "File replaced" : "Updated" });
    return sheet;
  }),

  /** Switch the link off, or make a new one — an old link never comes back to life. */
  setLink: protectedProcedure.input(z.object({ id: z.string(), on: z.boolean() })).mutation(async ({ ctx, input }) => {
    await ctx.db.factSheet.update({ where: { id: input.id }, data: { token: input.on ? newToken() : null } });
    await logAudit(ctx.db, { actorId: ctx.session.user.id, entity: "FactSheet", entityId: input.id, summary: input.on ? "New download link made" : "Download link switched off" });
  }),

  /** Delete one made by mistake. Refused once downloaded: its record is the CRM's — switch the link off instead. */
  remove: protectedProcedure.input(z.object({ id: z.string() })).mutation(async ({ ctx, input }) => {
    const sheet = await ctx.db.factSheet.findUniqueOrThrow({ where: { id: input.id }, include: { _count: { select: { downloads: true } } } });
    if (sheet._count.downloads) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "It has been downloaded — switch its link off instead, so who downloaded it stays on record." });
    }
    await ctx.db.factSheet.delete({ where: { id: input.id } });
    if (sheet.fileUrl && env.BLOB_READ_WRITE_TOKEN) await del(sheet.fileUrl).catch(() => undefined);
  }),

  /**
   * What a client's people downloaded (doc §4.12): by their contacts' emails,
   * and by anyone else at the client's email domain — those not contacts yet.
   */
  forClient: protectedProcedure.input(z.object({ clientId: z.string() })).query(async ({ ctx, input }) => {
    const client = await ctx.db.client.findUniqueOrThrow({
      where: { id: input.clientId },
      select: { email: true, website: true, contacts: { select: { email: true } } },
    });
    const emails = client.contacts.map((contact) => contact.email).filter((email): email is string => Boolean(email)).map(normalEmail);
    const domains = [...new Set([companyDomain(client.email), websiteDomain(client.website), ...emails.map(companyDomain)].filter((d): d is string => Boolean(d)))];
    if (!emails.length && !domains.length) return [];
    const downloads = await ctx.db.factSheetDownload.findMany({
      where: { OR: [{ email: { in: emails } }, ...domains.map((domain) => ({ email: { endsWith: `@${domain}` } }))] },
      orderBy: { createdAt: "desc" },
      include: { factSheet: { select: { id: true, title: true } } },
    });
    const who = await whoAre(ctx.db, downloads.map((download) => download.email));
    // Another client may have a stronger claim on the email — their contact: then it is theirs, not this one's.
    return downloads
      .map((download) => ({ ...download, who: who.get(download.email) ?? null }))
      .filter((download) => !download.who || download.who.client.id === input.clientId);
  }),

  // --- The download page, opened by a newsletter reader without signing in ----

  /** What the page shows: the title and description, nothing else of ours. */
  page: publicProcedure.input(z.object({ token: z.string().min(10) })).query(async ({ ctx, input }) => {
    const sheet = await ctx.db.factSheet.findUnique({ where: { token: input.token }, select: { title: true, description: true } });
    if (!sheet) throw new TRPCError({ code: "NOT_FOUND", message: "This link is not in use any more." });
    return sheet;
  }),

  /** Their email for the file: the download is recorded, and the file's address handed over. */
  download: publicProcedure
    .input(z.object({ token: z.string().min(10), email: z.string().trim().email("Please enter a valid email address").max(320) }))
    .mutation(async ({ ctx, input }) => {
      const sheet = await ctx.db.factSheet.findUnique({ where: { token: input.token }, select: { id: true, fileUrl: true, linkUrl: true } });
      const url = sheet?.fileUrl ?? sheet?.linkUrl;
      if (!sheet || !url) throw new TRPCError({ code: "NOT_FOUND", message: "This link is not in use any more." });
      await ctx.db.factSheetDownload.create({ data: { factSheetId: sheet.id, email: normalEmail(input.email) } });
      return { url };
    }),
});
