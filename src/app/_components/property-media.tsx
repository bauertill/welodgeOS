"use client";

import { useState } from "react";

import { Button, Field, FormError, friendlyError, Input, Select, Textarea } from "~/app/_components/form";
import { Photo } from "~/app/_components/photo";
import { env } from "~/env";
import { DROPBOX_APP_KEY, youtubeEmbed, youtubeId } from "~/lib/media";
import { api } from "~/trpc/react";

type ChooserFile = { name: string; link: string };
type DropboxWindow = Window & {
  Dropbox?: {
    choose: (options: {
      success: (files: ChooserFile[]) => void;
      cancel?: () => void;
      linkType: "preview" | "direct";
      multiselect: boolean;
      extensions: string[];
      folderselect: boolean;
    }) => void;
  };
};

/** Dropbox's Chooser script, loaded once, when first needed. */
function loadChooser(appKey: string) {
  const win = window as DropboxWindow;
  if (win.Dropbox) return Promise.resolve(win.Dropbox);
  return new Promise<NonNullable<DropboxWindow["Dropbox"]>>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "https://www.dropbox.com/static/api/2/dropins.js";
    script.id = "dropboxjs";
    script.dataset.appKey = appKey;
    script.onload = () => (win.Dropbox ? resolve(win.Dropbox) : reject(new Error("Dropbox did not load")));
    script.onerror = () => reject(new Error("Dropbox did not load"));
    document.body.appendChild(script);
  });
}

/**
 * A property's media (doc §3.10, Media): the YouTube video, the Dropbox
 * folder with all the team's photos, and the photos picked from it to show
 * clients on rate cards — chosen from Dropbox, or pasted as links. Nothing is
 * uploaded to us: the photos stay in Dropbox.
 */
export function PropertyMedia({ propertyId }: { propertyId: string }) {
  const utils = api.useUtils();
  const media = api.media.forProperty.useQuery({ propertyId });
  const refresh = () => void utils.media.forProperty.invalidate({ propertyId });

  if (!media.data) return <p className="text-ink-500 p-5 text-sm font-light">Loading…</p>;
  const data = media.data;
  // A YouTube video is picked media too — what rate cards show when there are no photos (the owner, 2026-10-18).
  const tube = youtubeId(data.videoUrl);
  const picked = data.photos.length + (tube ? 1 : 0);

  return (
    <div className="space-y-6 p-5">
      <MediaLinks propertyId={propertyId} videoUrl={data.videoUrl} photosUrl={data.photosUrl} onSaved={refresh} />
      <section>
        <div className="mb-1 flex flex-wrap items-baseline justify-between gap-2">
          <h3 className="text-ink-900 text-[14px] font-medium">Photos & videos for clients ({picked})</h3>
          {data.photosUrl && (
            <a href={data.photosUrl} target="_blank" rel="noreferrer" className="text-brand-700 text-xs hover:underline">
              Open the Dropbox folder ↗
            </a>
          )}
        </div>
        <p className="text-ink-500 mb-3 text-xs font-light">
          The best few photos and videos, picked from the Dropbox folder — they are what rate cards can show. The first is the cover. Tag a photo with its room category and it shows beside that room.
        </p>
        <AddPhotos propertyId={propertyId} onAdded={refresh} />
        {picked === 0 ? (
          <p className="text-ink-500 bg-ink-50/60 mt-3 rounded-lg px-4 py-6 text-center text-[13px] font-light">No photos or videos picked yet.</p>
        ) : (
          <ul className="mt-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {tube && (
              <li className="border-brand-300 overflow-hidden rounded-xl border-2 bg-white">
                <div className="relative aspect-video bg-black">
                  {/* eslint-disable-next-line @next/next/no-img-element -- YouTube's own thumbnail */}
                  <img src={`https://img.youtube.com/vi/${tube}/hqdefault.jpg`} alt="The YouTube video" className="h-full w-full object-cover" />
                  <span className="absolute inset-0 flex items-center justify-center">
                    <span className="rounded-xl bg-[#e0234e] px-4 py-2 text-lg leading-none text-white">▶</span>
                  </span>
                </div>
                <div className="px-3 py-2.5 text-[12px]">
                  <p className="text-ink-900 font-medium">YouTube video{data.photos.length ? "" : " — the cover"}</p>
                  <p className="text-ink-500 font-light">Plays on rate cards. Change it with <em>Edit links</em> above.</p>
                </div>
              </li>
            )}
            {data.photos.map((photo, index) => (
              <PhotoTile key={photo.id} photo={photo} index={index} last={index === data.photos.length - 1} categories={data.categories} onChanged={refresh} />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function MediaLinks({ propertyId, videoUrl, photosUrl, onSaved }: { propertyId: string; videoUrl: string | null; photosUrl: string | null; onSaved: () => void }) {
  const [editing, setEditing] = useState(!videoUrl && !photosUrl);
  const [video, setVideo] = useState(videoUrl ?? "");
  const [folder, setFolder] = useState(photosUrl ?? "");
  const save = api.media.setLinks.useMutation({
    onSuccess: () => {
      setEditing(false);
      onSaved();
    },
  });
  const embed = youtubeEmbed(videoUrl);

  if (editing) {
    return (
      <section className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Video — a YouTube link">
            <Input value={video} onChange={(e) => setVideo(e.target.value)} placeholder="https://www.youtube.com/watch?v=…" />
          </Field>
          <Field label="Photos folder — the Dropbox link">
            <Input value={folder} onChange={(e) => setFolder(e.target.value)} placeholder="https://www.dropbox.com/scl/fo/…" />
          </Field>
        </div>
        <FormError message={save.error ? friendlyError(save.error) : null} />
        <div className="flex items-center gap-2">
          <Button type="button" disabled={save.isPending} onClick={() => save.mutate({ propertyId, videoUrl: video, photosUrl: folder })}>
            {save.isPending ? "Saving…" : "Save"}
          </Button>
          {(videoUrl || photosUrl) && (
            <Button
              type="button"
              variant="secondary"
              onClick={() => {
                setVideo(videoUrl ?? "");
                setFolder(photosUrl ?? "");
                setEditing(false);
              }}
            >
              Cancel
            </Button>
          )}
        </div>
      </section>
    );
  }

  return (
    <section className="grid gap-4 sm:grid-cols-2">
      <div>
        <div className="mb-1 flex items-baseline justify-between">
          <h3 className="text-ink-900 text-[14px] font-medium">Video</h3>
          <button type="button" onClick={() => setEditing(true)} className="text-brand-700 text-xs hover:underline">
            Edit links
          </button>
        </div>
        {embed ? (
          <div className="relative aspect-video overflow-hidden rounded-lg bg-black">
            <iframe src={embed} title="Video" allow="encrypted-media; picture-in-picture" allowFullScreen className="absolute inset-0 h-full w-full" />
          </div>
        ) : videoUrl ? (
          <a href={videoUrl} target="_blank" rel="noreferrer" className="text-brand-700 text-[13px] break-all hover:underline">
            {videoUrl} ↗
          </a>
        ) : (
          <p className="text-ink-500 text-[13px] font-light">No video yet.</p>
        )}
      </div>
      <div>
        <h3 className="text-ink-900 mb-1 text-[14px] font-medium">Photos folder</h3>
        {photosUrl ? (
          <a href={photosUrl} target="_blank" rel="noreferrer" className="text-brand-700 text-[13px] hover:underline">
            Open in Dropbox ↗
          </a>
        ) : (
          <p className="text-ink-500 text-[13px] font-light">No Dropbox folder yet.</p>
        )}
      </div>
    </section>
  );
}

function AddPhotos({ propertyId, onAdded }: { propertyId: string; onAdded: () => void }) {
  const appKey = env.NEXT_PUBLIC_DROPBOX_APP_KEY ?? DROPBOX_APP_KEY;
  const [pasting, setPasting] = useState(false);
  const [links, setLinks] = useState("");
  const [result, setResult] = useState<string | null>(null);
  const [chooserError, setChooserError] = useState<string | null>(null);
  const add = api.media.addPhotos.useMutation({
    onSuccess: ({ added, skipped }) => {
      setResult(`${added} added${skipped ? ` · ${skipped} already there` : ""}.`);
      setLinks("");
      setPasting(false);
      onAdded();
    },
  });

  const choose = async () => {
    setChooserError(null);
    try {
      const dropbox = await loadChooser(appKey!);
      dropbox.choose({
        success: (files) => add.mutate({ propertyId, photos: files.map((file) => ({ url: file.link, name: file.name })) }),
        linkType: "preview",
        multiselect: true,
        extensions: ["images", "video"],
        folderselect: false,
      });
    } catch {
      setChooserError("Dropbox could not be opened — paste the photo links instead.");
    }
  };

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        {appKey && (
          <Button type="button" disabled={add.isPending} onClick={() => void choose()}>
            {add.isPending ? "Adding…" : "Choose from Dropbox"}
          </Button>
        )}
        <Button type="button" variant="secondary" onClick={() => setPasting(!pasting)}>
          Paste links
        </Button>
        {result && <span className="text-xs text-[#0a7a47]">{result}</span>}
      </div>
      {!appKey && (
        <p className="text-ink-500 text-xs font-light">
          Choosing straight from Dropbox comes once its app key is set (Till). Meanwhile: in Dropbox, open a photo, press <em>Copy link</em> and paste it here.
        </p>
      )}
      {chooserError && <p className="text-xs text-[#c03654]">{chooserError}</p>}
      {pasting && (
        <div className="space-y-2">
          <Textarea rows={3} value={links} onChange={(e) => setLinks(e.target.value)} placeholder={"One link per line — https://www.dropbox.com/scl/fi/…"} />
          <FormError message={add.error ? friendlyError(add.error) : null} />
          <Button
            type="button"
            disabled={add.isPending || !links.trim()}
            onClick={() =>
              add.mutate({
                propertyId,
                photos: links
                  .split(/\s+/)
                  .map((url) => url.trim())
                  .filter(Boolean)
                  .map((url) => ({ url })),
              })
            }
          >
            {add.isPending ? "Adding…" : "Add"}
          </Button>
        </div>
      )}
    </div>
  );
}

function PhotoTile({
  photo,
  index,
  last,
  categories,
  onChanged,
}: {
  photo: { id: string; url: string; src: string; name: string | null; caption: string | null; categoryId: string | null };
  index: number;
  last: boolean;
  categories: { id: string; name: string }[];
  onChanged: () => void;
}) {
  const [caption, setCaption] = useState(photo.caption ?? "");
  const update = api.media.updatePhoto.useMutation({ onSuccess: onChanged });
  const move = api.media.movePhoto.useMutation({ onSuccess: onChanged });
  const remove = api.media.removePhoto.useMutation({ onSuccess: onChanged });
  const busy = move.isPending || remove.isPending;

  return (
    <li className="border-ink-200/70 overflow-hidden rounded-xl border bg-white">
      <a href={photo.url} target="_blank" rel="noreferrer" className="bg-ink-50 relative block aspect-[4/3]" title="Open in Dropbox">
        <Photo src={photo.src} alt={photo.caption ?? photo.name ?? "Photo"} sizes="(min-width: 1280px) 260px, (min-width: 640px) 45vw, 100vw" />
        {index === 0 && <span className="bg-brand-500 absolute top-2 left-2 rounded-full px-2 py-0.5 text-[11px] font-medium text-white">Cover</span>}
      </a>
      <div className="space-y-2 p-3">
        {photo.name && <p className="text-ink-500 truncate text-[11px] font-light">{photo.name}</p>}
        <Input
          value={caption}
          placeholder="Caption — optional"
          aria-label="Caption"
          onChange={(e) => setCaption(e.target.value)}
          onBlur={() => caption !== (photo.caption ?? "") && update.mutate({ id: photo.id, caption, categoryId: photo.categoryId })}
        />
        <Select
          value={photo.categoryId ?? ""}
          aria-label="Room category"
          onChange={(e) => update.mutate({ id: photo.id, caption, categoryId: e.target.value || null })}
        >
          <option value="">Whole property</option>
          {categories.map((category) => (
            <option key={category.id} value={category.id}>
              {category.name}
            </option>
          ))}
        </Select>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
          {index > 0 && (
            <>
              <button type="button" disabled={busy} onClick={() => move.mutate({ id: photo.id, to: "cover" })} className="text-brand-700 hover:underline">
                Make cover
              </button>
              <button type="button" disabled={busy} onClick={() => move.mutate({ id: photo.id, to: "earlier" })} className="text-ink-500 hover:underline" aria-label="Move earlier">
                ←
              </button>
            </>
          )}
          {!last && (
            <button type="button" disabled={busy} onClick={() => move.mutate({ id: photo.id, to: "later" })} className="text-ink-500 hover:underline" aria-label="Move later">
              →
            </button>
          )}
          <button
            type="button"
            disabled={busy}
            onClick={() => window.confirm("Remove this photo? It stays in Dropbox, but comes off any rate card showing it.") && remove.mutate({ id: photo.id })}
            className="ml-auto text-[#c03654] hover:underline"
          >
            Remove
          </button>
        </div>
        <FormError message={update.error ? friendlyError(update.error) : null} />
      </div>
    </li>
  );
}
