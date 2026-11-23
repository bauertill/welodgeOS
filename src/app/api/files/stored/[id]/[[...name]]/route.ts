import { get } from "@vercel/blob";
import { NextResponse } from "next/server";

import { auth } from "~/server/auth";
import { db } from "~/server/db";

/** Opened in the browser rather than downloaded: pictures and PDFs. Everything else downloads. */
const INLINE = /^(image\/(png|jpeg|gif|webp)|application\/pdf)$/;

/**
 * Open a file uploaded for a record's document field — a quotation, a signed
 * contract, an invoice, an update's file (doc §2.8): only for someone signed
 * in. The store is private, so its own address does not open; this streams it.
 * The name on the end of the address is only for reading.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  const { id } = await params;
  const file = await db.storedFile.findUnique({ where: { id } });
  if (!file) return NextResponse.json({ error: "That file is no longer there." }, { status: 404 });
  const stored = await get(file.pathname, { access: "private" });
  if (!stored || stored.statusCode !== 200) return NextResponse.json({ error: "That file is no longer in the store." }, { status: 404 });
  const type = stored.blob.contentType || file.contentType || "application/octet-stream";
  const disposition = INLINE.test(type) ? "inline" : "attachment";
  return new Response(stored.stream, {
    headers: {
      "Content-Type": type,
      "Content-Length": String(stored.blob.size),
      "Content-Disposition": `${disposition}; filename*=UTF-8''${encodeURIComponent(file.name)}`,
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "private, no-store",
    },
  });
}
