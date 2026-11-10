import { db } from "~/server/db";
import { oauthError, redirectAllowed } from "~/server/mcp/oauth";

/**
 * An app registering itself to ask for access (doc §2.10) — OAuth dynamic
 * client registration (RFC 7591). Claude does this once, by itself; it gets
 * an id but no secret (it proves itself with PKCE instead), and may only send
 * people back to the addresses it registers here. Registering grants nothing:
 * every person still signs in and allows it.
 */
export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as { redirect_uris?: unknown; client_name?: unknown } | null;
  const uris = Array.isArray(body?.redirect_uris) ? body.redirect_uris.filter((uri): uri is string => typeof uri === "string") : [];
  if (uris.length === 0 || uris.length > 10 || !uris.every(redirectAllowed)) {
    return oauthError("invalid_redirect_uri", "Give one or more https return addresses.");
  }
  const name = typeof body?.client_name === "string" ? body.client_name.slice(0, 200) : null;
  const client = await db.mcpClient.create({ data: { name, redirectUris: uris } });
  return Response.json(
    {
      client_id: client.id,
      client_name: name ?? undefined,
      redirect_uris: uris,
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
      client_id_issued_at: Math.floor(client.createdAt.getTime() / 1000),
    },
    { status: 201, headers: { "Cache-Control": "no-store", "Access-Control-Allow-Origin": "*" } },
  );
}
