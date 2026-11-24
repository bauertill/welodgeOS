import { NextResponse } from "next/server";

import { artifactResponse } from "~/server/artifact-page";
import { auth } from "~/server/auth";
import { db } from "~/server/db";

/**
 * An artifact's page for the team (doc §4.13), shown in its OS page — the
 * current one, or `?version=N`. Signed in only; walled off like the client's link.
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  const { id } = await params;
  const version = Number(new URL(request.url).searchParams.get("version"));
  if (version) {
    const old = await db.artifactVersion.findUnique({ where: { artifactId_number: { artifactId: id, number: version } }, select: { html: true } });
    return old ? artifactResponse(old.html) : NextResponse.json({ error: "That version is no longer there." }, { status: 404 });
  }
  const row = await db.artifact.findUnique({ where: { id }, select: { html: true } });
  return row ? artifactResponse(row.html) : NextResponse.json({ error: "That artifact is no longer there." }, { status: 404 });
}
