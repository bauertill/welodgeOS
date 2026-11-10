import { auth } from "~/server/auth";
import { db } from "~/server/db";
import { CODE_MINUTES, fingerprint, newSecret, originOf } from "~/server/mcp/oauth";

/**
 * "Allow" pressed (doc §2.10): checked again, a one-time code is made for the
 * signed-in person and Claude is sent back with it. Only a form from this
 * site's own page is accepted.
 */
export async function POST(request: Request) {
  const origin = originOf(request);
  if (request.headers.get("origin") && request.headers.get("origin") !== origin) {
    return new Response("Not from WeLodge OS.", { status: 403 });
  }
  const session = await auth();
  if (!session?.user) return Response.redirect(`${origin}/signin`, 303);

  const form = await request.formData();
  const field = (key: string) => String(form.get(key) ?? "");
  const client = await db.mcpClient.findUnique({ where: { id: field("client_id") } });
  const redirectUri = field("redirect_uri");
  if (!client || !client.redirectUris.includes(redirectUri) || !field("code_challenge") || field("code_challenge_method") !== "S256") {
    return new Response("That request could not be checked — add the connector in Claude again.", { status: 400 });
  }

  const code = newSecret();
  await db.mcpAuthCode.create({
    data: {
      codeHash: fingerprint(code),
      clientId: client.id,
      userId: session.user.id,
      redirectUri,
      codeChallenge: field("code_challenge"),
      expiresAt: new Date(Date.now() + CODE_MINUTES * 60_000),
    },
  });
  const back = new URL(redirectUri);
  back.searchParams.set("code", code);
  if (field("state")) back.searchParams.set("state", field("state"));
  return Response.redirect(back.toString(), 303);
}
