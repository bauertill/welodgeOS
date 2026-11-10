import { originOf } from "~/server/mcp/oauth";

/**
 * Where Claude learns how to sign in to WeLodge OS (doc §2.10) — OAuth
 * authorization server metadata (RFC 8414). Answered at the bare address and
 * with a path after it, as clients ask either.
 */
export function GET(request: Request) {
  const origin = originOf(request);
  return Response.json(
    {
      issuer: origin,
      authorization_endpoint: `${origin}/oauth/authorize`,
      token_endpoint: `${origin}/api/oauth/token`,
      registration_endpoint: `${origin}/api/oauth/register`,
      response_types_supported: ["code"],
      grant_types_supported: ["authorization_code", "refresh_token"],
      code_challenge_methods_supported: ["S256"],
      token_endpoint_auth_methods_supported: ["none"],
      scopes_supported: ["welodge"],
    },
    { headers: { "Access-Control-Allow-Origin": "*" } },
  );
}
