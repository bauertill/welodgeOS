"use client";

import { useEffect, useState } from "react";

import { Photo } from "~/app/_components/photo";
import { isVideo } from "~/lib/media";

export type CardPhoto = { src: string; caption: string | null; room: string | null };

/**
 * A property's photos on a rate card (doc §4.11): the cover large, a few
 * more beside it, every one opening full size to page through.
 */
export function PhotoGallery({ photos, name }: { photos: CardPhoto[]; name: string }) {
  const [open, setOpen] = useState<number | null>(null);
  if (photos.length === 0) return null;
  const [cover, ...rest] = photos;
  const shown = rest.slice(0, 4);
  const more = rest.length - shown.length;
  return (
    <>
      <div className={`mt-4 grid gap-1.5 overflow-hidden rounded-xl ${shown.length ? "grid-cols-4 grid-rows-2" : ""}`} style={{ height: shown.length ? "15rem" : "17rem" }}>
        <button type="button" onClick={() => setOpen(0)} className={`relative ${shown.length ? "col-span-2 row-span-2" : "h-full"}`} aria-label="See the photos">
          <Photo src={cover!.src} alt={cover!.caption ?? name} sizes="(min-width: 768px) 360px, 60vw" />
        </button>
        {shown.map((photo, index) => (
          <button
            key={index}
            type="button"
            onClick={() => setOpen(index + 1)}
            className={`relative ${shown.length === 1 ? "col-span-2 row-span-2" : shown.length === 2 ? "col-span-2" : shown.length === 3 && index === 0 ? "row-span-2" : ""}`}
            aria-label={`Photo ${index + 2}`}
          >
            <Photo src={photo.src} alt={photo.caption ?? name} sizes="(min-width: 768px) 180px, 30vw" />
            {more > 0 && index === shown.length - 1 && (
              <span className="absolute inset-0 flex items-center justify-center bg-black/45 text-sm font-medium text-white">+{more} more</span>
            )}
          </button>
        ))}
      </div>
      {open !== null && <Lightbox photos={photos} start={open} name={name} onClose={() => setOpen(null)} />}
    </>
  );
}

/** Every photo and video of the property, opened over the card — the client stays on it. */
export function SeeAllMedia({ media, name }: { media: CardPhoto[]; name: string }) {
  const [open, setOpen] = useState(false);
  const videos = media.filter((item) => isVideo(item.src)).length;
  const label = videos === media.length ? "videos" : videos ? "photos & videos" : "photos";
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className="text-brand-700 hover:underline print:hidden">
        See all {label} ({media.length})
      </button>
      {open && <Lightbox photos={media} start={0} name={name} onClose={() => setOpen(false)} />}
    </>
  );
}

/** "2 photos" beside a room, when some photos are of that room. */
export function RoomPhotos({ photos, name }: { photos: CardPhoto[]; name: string }) {
  const [open, setOpen] = useState(false);
  if (photos.length === 0) return null;
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className="text-brand-700 ml-2 text-xs hover:underline print:hidden">
        {photos.length === 1 ? "1 photo" : `${photos.length} photos`}
      </button>
      {open && <Lightbox photos={photos} start={0} name={name} onClose={() => setOpen(false)} />}
    </>
  );
}

function Lightbox({ photos, start, name, onClose }: { photos: CardPhoto[]; start: number; name: string; onClose: () => void }) {
  const [at, setAt] = useState(start);
  const photo = photos[at]!;
  const go = (step: number) => setAt((current) => (current + step + photos.length) % photos.length);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
      if (event.key === "ArrowRight") go(1);
      if (event.key === "ArrowLeft") go(-1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div role="dialog" aria-label={`Photos of ${name}`} className="fixed inset-0 z-50 flex flex-col bg-black/90 print:hidden" onClick={onClose}>
      <div className="flex items-center justify-between px-5 py-3 text-sm text-white/80">
        <span>
          {name} · {at + 1} of {photos.length}
        </span>
        <button type="button" onClick={onClose} className="text-2xl leading-none text-white hover:text-white/70" aria-label="Close">
          ×
        </button>
      </div>
      <div className="relative min-h-0 flex-1" onClick={(event) => event.stopPropagation()}>
        <Photo key={photo.src} src={photo.src} alt={photo.caption ?? name} sizes="100vw" controls className="!object-contain" priority />
        {photos.length > 1 && (
          <>
            <button type="button" onClick={() => go(-1)} aria-label="Previous photo" className="absolute top-1/2 left-3 -translate-y-1/2 rounded-full bg-white/15 px-3 py-2 text-2xl text-white hover:bg-white/25">
              ‹
            </button>
            <button type="button" onClick={() => go(1)} aria-label="Next photo" className="absolute top-1/2 right-3 -translate-y-1/2 rounded-full bg-white/15 px-3 py-2 text-2xl text-white hover:bg-white/25">
              ›
            </button>
          </>
        )}
      </div>
      <p className="min-h-10 px-5 py-3 text-center text-sm text-white/85" onClick={(event) => event.stopPropagation()}>
        {[photo.room, photo.caption].filter(Boolean).join(" — ")}
      </p>
    </div>
  );
}
