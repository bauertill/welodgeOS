import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { NextResponse } from "next/server";

import { env } from "~/env";
import { MAX_FACT_SHEET_BYTES } from "~/lib/fact-sheets";
import { auth } from "~/server/auth";

/**
 * Lets a signed-in team member's browser send a fact sheet's PDF straight to
 * our file store, Vercel Blob (doc §4.12) — the file never passes through our
 * own server, which caps a request at a few megabytes. Only PDFs, up to 50 MB;
 * the fact sheet itself is saved once the upload is done.
 */
export async function POST(request: Request) {
  if (!env.BLOB_READ_WRITE_TOKEN) {
    return NextResponse.json({ error: "Uploading is not switched on yet — paste a link to the PDF instead." }, { status: 400 });
  }
  const body = (await request.json()) as HandleUploadBody;
  try {
    const result = await handleUpload({
      body,
      request,
      onBeforeGenerateToken: async () => {
        const session = await auth();
        if (!session?.user) throw new Error("Sign in to upload.");
        return { allowedContentTypes: ["application/pdf"], maximumSizeInBytes: MAX_FACT_SHEET_BYTES, addRandomSuffix: true };
      },
    });
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "The upload failed." }, { status: 400 });
  }
}
