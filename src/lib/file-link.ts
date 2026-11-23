/**
 * A document on a record (doc §2.8): either a link pasted from elsewhere
 * (Google Drive, Dropbox…) or a file uploaded to the site's own store, which
 * opens at /api/files/stored/<id>/<name> for someone signed in.
 */
export const STORED_PREFIX = "/api/files/stored/";

export const isStoredLink = (value: string | null | undefined) => Boolean(value?.startsWith(STORED_PREFIX));

/** What a document field accepts: empty, a whole web link, or an uploaded file. */
export const isFileLink = (value: string) => value === "" || /^https?:\/\//.test(value) || isStoredLink(value);

export const FILE_LINK_MESSAGE = "Upload the file, or paste the whole link, starting with https://";

/** An uploaded file's address — its name on the end, so the link reads as the file. */
export const storedLink = (id: string, name: string) => `${STORED_PREFIX}${id}/${encodeURIComponent(name)}`;

/** The file's name from its address, or null for a pasted link. */
export const storedName = (value: string | null | undefined) => {
  if (!value || !isStoredLink(value)) return null;
  const name = value.slice(STORED_PREFIX.length).split("/")[1];
  try {
    return name ? decodeURIComponent(name) : "Uploaded file";
  } catch {
    return name ?? "Uploaded file";
  }
};

/** How a document link is shown: the uploaded file's name, else the place it is. */
export const linkLabel = (value: string, fallback: string) => storedName(value) ?? fallback;
