import { del, head } from "@vercel/blob";

/**
 * Files put on records (doc §2.8, 2026-11-18): kept in the site's private
 * file store — Vercel Blob, switched on for the project as "welodge-files" —
 * uploaded straight from the browser, so a large file never passes through
 * the site, and opened only through /api/files/<id>, by someone signed in.
 */
export const MAX_FILE_BYTES = 100 * 1024 * 1024;
export const MAX_FILE_LABEL = "100 MB";

/** Where a task's files go in the store: under the task, so an upload can only be recorded on its own task. */
export const taskFilePrefix = (taskId: string) => `tasks/${taskId}/`;

export const filesConfigured = () => Boolean(process.env.BLOB_READ_WRITE_TOKEN);

/** What the store holds at that place — its real size and type — or null when nothing was uploaded there. */
export async function storedFile(pathname: string) {
  try {
    return await head(pathname);
  } catch {
    return null;
  }
}

/** Remove files from the store; a file already gone is not an error. */
export async function deleteStored(pathnames: string[]) {
  if (!pathnames.length || !filesConfigured()) return;
  try {
    await del(pathnames);
  } catch (error) {
    console.error("Could not delete stored files", error);
  }
}
