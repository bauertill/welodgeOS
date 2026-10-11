import Image from "next/image";

/**
 * A property photo (doc §3.10, Media). From Dropbox it is made web-sized on
 * the way; from anywhere else it is shown as it is.
 */
export function Photo({ src, alt, sizes, className = "", priority = false }: { src: string; alt: string; sizes: string; className?: string; priority?: boolean }) {
  const fromDropbox = src.startsWith("https://dl.dropboxusercontent.com/");
  return <Image src={src} alt={alt} fill sizes={sizes} unoptimized={!fromDropbox} priority={priority} className={`object-cover ${className}`} />;
}
