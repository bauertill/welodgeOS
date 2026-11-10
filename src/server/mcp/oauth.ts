import { createHash, randomBytes } from "crypto";

import { db } from "~/server/db";

/**
 * Signing Claude in to WeLodge OS (doc §2.10): standard OAuth 2.1 with PKCE,
 * the way claude.ai connects to any app. The person signs in to WeLodge as
 * always and allows Claude; Claude gets a key that lets it act as them. Keys
 * and codes are random and only their fingerprints (SHA-256) are stored, so a
 * copy of the database is no key to anything.
 */

export const ACCESS_SECONDS = 60 * 60; // an hour, renewed quietly with the refresh key
export const REFRESH_DAYS = 60;
export const CODE_MINUTES = 10;

export const newSecret = () => randomBytes(32).toString("base64url");
export const fingerprint = (secret: string) => createHash("sha256").update(secret).digest("hex");

/** PKCE S256: the verifier the app kept, hashed, must be the challenge it sent. */
export const pkceMatches = (verifier: string, challenge: string) =>
  createHash("sha256").update(verifier).digest("base64url") === challenge;

/** The site's own address as the visitor reached it — os.welodge.net, staging, or localhost. */
export function originOf(request: Request) {
  const url = new URL(request.url);
  const host = request.headers.get("x-forwarded-host") ?? url.host;
  const proto = request.headers.get("x-forwarded-proto") ?? url.protocol.replace(":", "");
  return `${proto}://${host}`;
}

/**
 * Where an app may send people back to after sign-in: its own https address,
 * or the person's own computer for a desktop app. Anything else is refused.
 */
export function redirectAllowed(uri: string) {
  try {
    const url = new URL(uri);
    if (url.hash) return false;
    return url.protocol === "https:" || (url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname));
  } catch {
    return false;
  }
}

/** The person a request's key belongs to, or null — expired, disconnected or made up. */
export async function personFor(request: Request) {
  const header = request.headers.get("authorization") ?? "";
  const key = /^Bearer\s+(.+)$/i.exec(header)?.[1]?.trim();
  if (!key) return null;
  const token = await db.mcpToken.findUnique({
    where: { accessHash: fingerprint(key) },
    select: { id: true, expiresAt: true, revokedAt: true, lastUsedAt: true, user: { select: { id: true, name: true, email: true, image: true } } },
  });
  if (!token || token.revokedAt || token.expiresAt < new Date()) return null;
  // Noted at most once a minute — enough for "last used" on My profile.
  if (!token.lastUsedAt || Date.now() - token.lastUsedAt.getTime() > 60_000) {
    await db.mcpToken.update({ where: { id: token.id }, data: { lastUsedAt: new Date() } });
  }
  return token.user;
}

/** OAuth's JSON error, as clients expect it. */
export const oauthError = (error: string, description: string, status = 400) =>
  Response.json({ error, error_description: description }, { status, headers: { "Cache-Control": "no-store" } });
