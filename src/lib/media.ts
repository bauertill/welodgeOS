/**
 * A property's media (doc §3.10): photos stay in Dropbox and are shown from
 * their shared links; videos stay on YouTube. Nothing is uploaded to us.
 */

/** Is this a Dropbox link? */
export function isDropbox(url: string) {
  try {
    return /(^|\.)dropbox\.com$/.test(new URL(url).hostname);
  } catch {
    return false;
  }
}

/**
 * The address that serves the photo itself. A Dropbox shared link opens
 * Dropbox's preview page; the same file is served raw from
 * dl.dropboxusercontent.com with the link's key. Other links are used as given.
 */
export function photoSrc(url: string) {
  try {
    const link = new URL(url);
    if (!/(^|\.)dropbox\.com$/.test(link.hostname)) return url;
    link.hostname = "dl.dropboxusercontent.com";
    link.searchParams.delete("dl");
    link.searchParams.delete("raw");
    link.searchParams.delete("st");
    return link.toString();
  } catch {
    return url;
  }
}

/** A Dropbox link to a folder rather than one file — "/scl/fo/" or "/sh/". */
export function isDropboxFolder(url: string) {
  try {
    const link = new URL(url);
    return isDropbox(url) && (link.pathname.startsWith("/scl/fo/") || link.pathname.startsWith("/sh/"));
  } catch {
    return false;
  }
}

/** The YouTube video's id, from any of its link forms; null for anything else. */
export function youtubeId(url: string | null | undefined) {
  if (!url) return null;
  try {
    const link = new URL(url);
    const host = link.hostname.replace(/^www\.|^m\./, "");
    if (host === "youtu.be") return link.pathname.slice(1).split("/")[0] || null;
    if (host === "youtube.com" || host === "youtube-nocookie.com") {
      if (link.searchParams.get("v")) return link.searchParams.get("v");
      const match = /^\/(?:embed|shorts|live)\/([^/?]+)/.exec(link.pathname);
      return match?.[1] ?? null;
    }
    return null;
  } catch {
    return null;
  }
}

/** Where the video plays inside a page — YouTube's privacy-enhanced player. */
export function youtubeEmbed(url: string | null | undefined) {
  const id = youtubeId(url);
  return id ? `https://www.youtube-nocookie.com/embed/${id}` : null;
}

/** A link worth saving: http(s), with a host. */
export function isLink(url: string) {
  try {
    const link = new URL(url);
    return (link.protocol === "https:" || link.protocol === "http:") && Boolean(link.hostname);
  } catch {
    return false;
  }
}

/**
 * What a rate card shows the client of a property's media (doc §4.11): the
 * photos chosen for the card, in order, each with its caption and room; the
 * video to play; the Dropbox folder for all the photos.
 */
export function clientMedia(property: {
  videoUrl: string | null;
  photosUrl: string | null;
  allPhotos: { id: string; src: string; caption: string | null; categoryId: string | null; categoryName: string | null }[];
  photoIds: string[];
}) {
  return {
    video: youtubeEmbed(property.videoUrl),
    videoUrl: property.videoUrl,
    photosUrl: property.photosUrl,
    photos: property.photoIds
      .map((id) => property.allPhotos.find((photo) => photo.id === id))
      .filter((photo): photo is (typeof property.allPhotos)[number] => Boolean(photo))
      .map((photo) => ({ src: photo.src, caption: photo.caption, room: photo.categoryName, categoryId: photo.categoryId })),
  };
}
