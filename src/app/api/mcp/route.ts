import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";

import { originOf, personFor } from "~/server/mcp/oauth";
import { welodgeServer } from "~/server/mcp/tools";

/**
 * The WeLodge OS connector for Claude (doc §2.10) — an MCP server. Each call
 * carries the key of the person who connected Claude; without a valid one it
 * is refused and told where to sign in. Stateless: every request stands alone,
 * as suits a serverless host.
 */
export const maxDuration = 60;

async function handle(request: Request) {
  const person = await personFor(request);
  if (!person) {
    return new Response(JSON.stringify({ error: "invalid_token", error_description: "Connect Claude to WeLodge OS and sign in." }), {
      status: 401,
      headers: {
        "Content-Type": "application/json",
        "WWW-Authenticate": `Bearer resource_metadata="${originOf(request)}/.well-known/oauth-protected-resource"`,
      },
    });
  }
  const server = welodgeServer(person, request.headers);
  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  await server.connect(transport);
  return transport.handleRequest(request);
}

export { handle as GET, handle as POST, handle as DELETE };
