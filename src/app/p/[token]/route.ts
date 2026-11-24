import { artifactNotFound, artifactResponse } from "~/server/artifact-page";
import { db } from "~/server/db";

export const dynamic = "force-dynamic";

/**
 * PUBLIC: an artifact's client link (doc §4.13) — os.welodge.net/p/<token>,
 * the page alone, walled off from OS, not indexed. Gone once the link is
 * switched off or the artifact archived.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (token.length < 16 || token.length > 100) return artifactNotFound();
  const row = await db.artifact.findFirst({ where: { shareToken: token, shareEnabled: true, archived: false }, select: { html: true } });
  return row ? artifactResponse(row.html) : artifactNotFound();
}
