import Image from "next/image";

import { isVideo } from "~/lib/media";

/**
 * A property photo or video (doc §3.10, Media). A photo from Dropbox is made
 * web-sized on the way; one from anywhere else is shown as it is. A video —
 * told by its file name — shows its first frame with a ▶, or plays with its
 * controls where asked (full size).
 */
export function Photo({
  src,
  alt,
  sizes,
  className = "",
  priority = false,
  controls = false,
}: {
  src: string;
  alt: string;
  sizes: string;
  className?: string;
  priority?: boolean;
  /** A video plays, with its controls, rather than showing a still. */
  controls?: boolean;
}) {
  if (isVideo(src)) {
    return controls ? (
      <video src={src} controls autoPlay playsInline className={`absolute inset-0 h-full w-full object-contain ${className}`} aria-label={alt} />
    ) : (
      <>
        <video src={`${src}${src.includes("#") ? "" : "#t=0.5"}`} muted playsInline preload="metadata" className={`absolute inset-0 h-full w-full object-cover ${className}`} aria-label={alt} />
        <span className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <span className="flex h-10 w-10 items-center justify-center rounded-full bg-black/55 pl-0.5 text-lg text-white">▶</span>
        </span>
      </>
    );
  }
  const fromDropbox = src.startsWith("https://dl.dropboxusercontent.com/");
  return <Image src={src} alt={alt} fill sizes={sizes} unoptimized={!fromDropbox} priority={priority} className={`object-cover ${className}`} />;
}
