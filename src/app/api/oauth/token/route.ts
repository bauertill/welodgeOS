import { db } from "~/server/db";
import { ACCESS_SECONDS, REFRESH_DAYS, fingerprint, newSecret, oauthError, pkceMatches } from "~/server/mcp/oauth";

/**
 * Where Claude trades its one-time code — or its refresh key — for a fresh
 * access key (doc §2.10). A code works once and for ten minutes, only with
 * the PKCE proof of the app that asked for it; a refresh key is replaced
 * each time it is used, and a disconnected connection is refused.
 */
export async function POST(request: Request) {
  const form = new URLSearchParams(await request.text());
  const field = (key: string) => form.get(key) ?? "";
  const grant = field("grant_type");

  if (grant === "authorization_code") {
    const code = await db.mcpAuthCode.findUnique({ where: { codeHash: fingerprint(field("code")) } });
    if (!code || code.usedAt || code.expiresAt < new Date()) return oauthError("invalid_grant", "That code is expired or was already used.");
    if (code.clientId !== field("client_id") || code.redirectUri !== field("redirect_uri")) return oauthError("invalid_grant", "That code was not given to this app.");
    if (!pkceMatches(field("code_verifier"), code.codeChallenge)) return oauthError("invalid_grant", "The PKCE proof does not match.");
    await db.mcpAuthCode.update({ where: { id: code.id }, data: { usedAt: new Date() } });
    return issue(code.clientId, code.userId);
  }

  if (grant === "refresh_token") {
    const token = await db.mcpToken.findUnique({ where: { refreshHash: fingerprint(field("refresh_token")) } });
    if (!token || token.revokedAt || token.refreshExpiresAt < new Date()) return oauthError("invalid_grant", "Sign in again — this connection was disconnected or has run out.");
    if (field("client_id") && field("client_id") !== token.clientId) return oauthError("invalid_grant", "That key was not given to this app.");
    // One connection, its keys renewed: the old pair stops working at once.
    await db.mcpToken.update({ where: { id: token.id }, data: { revokedAt: new Date() } });
    return issue(token.clientId, token.userId);
  }

  return oauthError("unsupported_grant_type", "Only authorization_code and refresh_token are accepted.");
}

async function issue(clientId: string, userId: string) {
  const access = newSecret();
  const refresh = newSecret();
  await db.mcpToken.create({
    data: {
      accessHash: fingerprint(access),
      refreshHash: fingerprint(refresh),
      clientId,
      userId,
      expiresAt: new Date(Date.now() + ACCESS_SECONDS * 1000),
      refreshExpiresAt: new Date(Date.now() + REFRESH_DAYS * 86_400_000),
    },
  });
  return Response.json(
    { access_token: access, token_type: "Bearer", expires_in: ACCESS_SECONDS, refresh_token: refresh, scope: "welodge" },
    { headers: { "Cache-Control": "no-store", "Access-Control-Allow-Origin": "*" } },
  );
}
