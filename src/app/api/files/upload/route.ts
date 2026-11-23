import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { NextResponse } from "next/server";

import { auth } from "~/server/auth";
import { db } from "~/server/db";
import { filesConfigured, MAX_FILE_BYTES, taskFilePrefix } from "~/server/files";

/**
 * Lets the browser upload a file straight to the private file store (doc
 * §2.8): only for someone signed in, only under an existing task's own place,
 * and no larger than the limit. The file is recorded on the task afterwards
 * (task.addFile), which checks it arrived.
 */
export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  if (!filesConfigured()) return NextResponse.json({ error: "File uploads are not set up on this site." }, { status: 503 });
  const body = (await request.json()) as HandleUploadBody;
  try {
    const result = await handleUpload({
      body,
      request,
      onBeforeGenerateToken: async (pathname, clientPayload) => {
        const taskId = clientPayload ?? "";
        const task = taskId ? await db.task.findUnique({ where: { id: taskId }, select: { id: true, private: true, createdById: true } }) : null;
        if (!task || (task.private && task.createdById !== session.user.id) || !pathname.startsWith(taskFilePrefix(task.id))) throw new Error("That task was not found.");
        return { maximumSizeInBytes: MAX_FILE_BYTES, addRandomSuffix: true };
      },
    });
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "The upload could not start." }, { status: 400 });
  }
}
