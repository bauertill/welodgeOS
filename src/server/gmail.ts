import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "crypto";

import type { PrismaClient } from "generated/prisma";
import { env } from "~/env";

/**
 * Client emails from Gmail (doc §4.10). Each colleague connects their own
 * mailbox, read-only; the system asks Gmail only for messages to, from or
 * copying one of our clients' contacts — nothing else in a mailbox is read —
 * and keeps each such email once, as plain text, however many mailboxes it
 * is in. Google's refresh key is kept encrypted.
 */

export const GMAIL_SCOPE = "https://www.googleapis.com/auth/gmail.readonly";
/** How far back a mailbox, or a newly added contact, is read the first time (the owner, 2026-11-10). */
export const FIRST_SYNC_DAYS = 30;
/** Opening the emails syncs mailboxes not synced for this long. */
export const RESYNC_MINUTES = 10;
const BATCH = 25; // contact addresses per Gmail search
const BODY_LIMIT = 100_000;

// --- The refresh key, encrypted at rest (AES-256-GCM, key derived from AUTH_SECRET) --------

const key = () => Buffer.from(hkdfSync("sha256", env.AUTH_SECRET ?? "welodge-dev-secret", "welodge-os", "gmail-refresh-token", 32));
export function seal(text: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const data = Buffer.concat([cipher.update(text, "utf8"), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), data]).toString("base64url");
}
export function unseal(sealed: string) {
  const raw = Buffer.from(sealed, "base64url");
  const decipher = createDecipheriv("aes-256-gcm", key(), raw.subarray(0, 12));
  decipher.setAuthTag(raw.subarray(12, 28));
  return Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString("utf8");
}

// --- Google --------------------------------------------------------------------------

export const gmailConfigured = () => Boolean(env.AUTH_GOOGLE_ID && env.AUTH_GOOGLE_SECRET);

export function consentUrl(origin: string, state: string, loginHint?: string | null) {
  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.searchParams.set("client_id", env.AUTH_GOOGLE_ID ?? "");
  url.searchParams.set("redirect_uri", `${origin}/api/gmail/callback`);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", GMAIL_SCOPE);
  url.searchParams.set("access_type", "offline");
  url.searchParams.set("prompt", "consent");
  url.searchParams.set("state", state);
  if (loginHint) url.searchParams.set("login_hint", loginHint);
  return url.toString();
}

async function tokenRequest(body: Record<string, string>) {
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: env.AUTH_GOOGLE_ID ?? "", client_secret: env.AUTH_GOOGLE_SECRET ?? "", ...body }),
  });
  const json = (await response.json().catch(() => ({}))) as { access_token?: string; refresh_token?: string; error?: string; error_description?: string };
  if (!response.ok || !json.access_token) throw new Error(json.error_description ?? json.error ?? `Google answered ${response.status}`);
  return json;
}

export const exchangeCode = (code: string, origin: string) =>
  tokenRequest({ grant_type: "authorization_code", code, redirect_uri: `${origin}/api/gmail/callback` });

const accessTokenFor = async (refreshTokenEnc: string) => (await tokenRequest({ grant_type: "refresh_token", refresh_token: unseal(refreshTokenEnc) })).access_token!;

async function gmail<T>(accessToken: string, path: string, query: Record<string, string> = {}) {
  const url = new URL(`https://gmail.googleapis.com/gmail/v1/users/me/${path}`);
  for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v);
  const response = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!response.ok) throw new Error(`Gmail answered ${response.status}: ${(await response.text()).slice(0, 200)}`);
  return (await response.json()) as T;
}

export const mailboxAddress = async (accessToken: string) => (await gmail<{ emailAddress: string }>(accessToken, "profile")).emailAddress;

// --- Reading one message -------------------------------------------------------------------

type Part = { mimeType?: string; filename?: string; headers?: { name: string; value: string }[]; body?: { data?: string; size?: number }; parts?: Part[] };
type Message = { id: string; threadId?: string; snippet?: string; internalDate?: string; payload?: Part };

const decode = (data?: string) => (data ? Buffer.from(data, "base64url").toString("utf8") : "");
/** Every address in a header like `Mike Taylor <miket@olympic.org.nz>, lisa@rowingnz.kiwi`. */
export const addressesIn = (header: string | undefined) => [...(header ?? "").matchAll(/[A-Z0-9._%+'-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi)].map((m) => m[0].toLowerCase());
const nameIn = (header: string | undefined) => header?.replace(/<[^>]*>/, "").replace(/"/g, "").trim() || null;
/** HTML as readable text: tags out, line breaks kept, entities for the common characters. */
export function htmlToText(html: string) {
  return html
    .replace(/<(script|style|head)[\s\S]*?<\/\1>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|tr|li|h\d)>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function readMessage(message: Message) {
  const header = (name: string) => message.payload?.headers?.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value;
  let plain = "";
  let html = "";
  const attachments: string[] = [];
  const walk = (part?: Part) => {
    if (!part) return;
    if (part.filename) attachments.push(part.filename);
    else if (part.mimeType === "text/plain" && !plain) plain = decode(part.body?.data);
    else if (part.mimeType === "text/html" && !html) html = decode(part.body?.data);
    part.parts?.forEach(walk);
  };
  walk(message.payload);
  const from = header("From");
  const to = addressesIn(header("To"));
  const cc = addressesIn(header("Cc"));
  const fromEmail = addressesIn(from)[0] ?? "unknown";
  return {
    messageId: header("Message-ID") ?? header("Message-Id") ?? `gmail:${message.id}`,
    threadId: message.threadId ?? null,
    subject: header("Subject") ?? null,
    fromName: nameIn(from),
    fromEmail,
    to,
    cc,
    addresses: [...new Set([fromEmail, ...to, ...cc])],
    sentAt: message.internalDate ? new Date(Number(message.internalDate)) : new Date(header("Date") ?? Date.now()),
    snippet: message.snippet ?? null,
    bodyText: (plain || htmlToText(html)).slice(0, BODY_LIMIT) || null,
    attachmentNames: attachments.filter(Boolean),
  };
}

// --- Syncing a mailbox ---------------------------------------------------------------------

/** The Gmail search for some addresses, from a time on: `{from:a to:a cc:a …} after:…`. */
export const searchFor = (addresses: string[], since: { afterSeconds?: number; newerThanDays?: number }) =>
  `{${addresses.flatMap((a) => [`from:${a}`, `to:${a}`, `cc:${a}`]).join(" ")}} ${
    since.afterSeconds !== undefined ? `after:${since.afterSeconds}` : `newer_than:${since.newerThanDays}d`
  }`;

/**
 * Bring one mailbox's emails with our contacts up to date: the addresses it
 * already covered since its last sync (a day's overlap, for safety), and any
 * contact added since then over the last month. Stops at the deadline and
 * picks up where it left off next time: what was already kept is skipped.
 */
export async function syncMailbox(db: PrismaClient, connectionId: string, deadline: number) {
  const connection = await db.gmailConnection.findUniqueOrThrow({ where: { id: connectionId } });
  const started = new Date();
  try {
    const accessToken = await accessTokenFor(connection.refreshTokenEnc);
    const known = [...new Set((await db.clientContact.findMany({ where: { email: { not: null } }, select: { email: true } })).map((c) => c.email!.trim().toLowerCase()))].filter(
      (a) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(a),
    );
    const covered = new Set(connection.coveredAddresses);
    const old = connection.lastSyncedAt ? known.filter((a) => covered.has(a)) : [];
    const fresh = known.filter((a) => !old.includes(a));
    const searches = [
      ...chunk(old, BATCH).map((batch) => searchFor(batch, { afterSeconds: Math.floor(connection.lastSyncedAt!.getTime() / 1000) - 86_400 })),
      ...chunk(fresh, BATCH).map((batch) => searchFor(batch, { newerThanDays: FIRST_SYNC_DAYS })),
    ];
    let kept = 0;
    for (const q of searches) {
      let pageToken: string | undefined;
      do {
        if (Date.now() > deadline) return { done: false, kept };
        const page = await gmail<{ messages?: { id: string }[]; nextPageToken?: string }>(accessToken, "messages", { q, maxResults: "100", ...(pageToken && { pageToken }) });
        for (const { id } of page.messages ?? []) {
          if (Date.now() > deadline) return { done: false, kept };
          if (await db.emailCopy.findUnique({ where: { connectionId_gmailId: { connectionId, gmailId: id } }, select: { id: true } })) continue;
          const read = readMessage(await gmail<Message>(accessToken, `messages/${id}`, { format: "full" }));
          const email = await db.clientEmail.upsert({ where: { messageId: read.messageId }, create: read, update: {}, select: { id: true } });
          await db.emailCopy.create({ data: { emailId: email.id, connectionId, gmailId: id } });
          kept++;
        }
        pageToken = page.nextPageToken;
      } while (pageToken);
    }
    await db.gmailConnection.update({ where: { id: connectionId }, data: { lastSyncedAt: started, coveredAddresses: known, lastError: null } });
    return { done: true, kept };
  } catch (error) {
    const message = error instanceof Error ? error.message : "The sync failed.";
    await db.gmailConnection.update({ where: { id: connectionId }, data: { lastError: message.slice(0, 500) } });
    return { done: false, kept: 0, error: message };
  }
}

/** Every connected mailbox not synced in the last few minutes (or all, when forced), within a time budget. */
export async function syncAll(db: PrismaClient, { budgetMs, force = false }: { budgetMs: number; force?: boolean }) {
  if (!gmailConfigured()) return { synced: 0 };
  const deadline = Date.now() + budgetMs;
  const due = await db.gmailConnection.findMany({
    where: force ? {} : { OR: [{ lastSyncedAt: null }, { lastSyncedAt: { lt: new Date(Date.now() - RESYNC_MINUTES * 60_000) } }] },
    orderBy: { lastSyncedAt: { sort: "asc", nulls: "first" } },
    select: { id: true },
  });
  let synced = 0;
  for (const { id } of due) {
    if (Date.now() > deadline) break;
    const result = await syncMailbox(db, id, deadline);
    if (result.done) synced++;
  }
  return { synced, of: due.length };
}

const chunk = <T,>(items: T[], size: number) => Array.from({ length: Math.ceil(items.length / size) }, (_, i) => items.slice(i * size, i * size + size));
