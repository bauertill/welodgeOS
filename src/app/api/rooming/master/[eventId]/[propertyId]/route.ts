import { NextResponse } from "next/server";

import { auth } from "~/server/auth";
import { db } from "~/server/db";
import { masterWorkbook } from "~/server/rooming-excel";

/** A property's master rooming list as an Excel file, for the hotel (doc §6.9). ?version=3 gives V3 as it was sent. */
export async function GET(request: Request, { params }: { params: Promise<{ eventId: string; propertyId: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  const { eventId, propertyId } = await params;
  const wanted = Number(new URL(request.url).searchParams.get("version") ?? "") || null;
  const made = await masterWorkbook(db, eventId, propertyId, { version: wanted }).catch((error: unknown) => (error instanceof Error ? error : new Error("Could not make the file.")));
  if (made instanceof Error) return NextResponse.json({ error: made.message }, { status: 404 });
  const { file, name } = made;
  return new Response(new Blob([file as BlobPart]), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(name)}`,
      "Cache-Control": "private, no-store",
    },
  });
}
