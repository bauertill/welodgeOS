import { originOf } from "~/server/mcp/oauth";

/**
 * Which server guards the connector (doc §2.10) — OAuth protected resource
 * metadata (RFC 9728). The connector at /api/mcp points here when asked without a key.
 */
export function GET(request: Request) {
  const origin = originOf(request);
  return Response.json(
    {
      resource: `${origin}/api/mcp`,
      authorization_servers: [origin],
      bearer_methods_supported: ["header"],
      scopes_supported: ["welodge"],
      resource_name: "WeLodge OS",
    },
    { headers: { "Access-Control-Allow-Origin": "*" } },
  );
}
