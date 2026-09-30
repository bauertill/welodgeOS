"use client";

import { keepPreviousData } from "@tanstack/react-query";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { Button, Input } from "~/app/_components/form";
import { api, type RouterOutputs } from "~/trpc/react";

/**
 * The extras of chat (doc §2.7): emoji and the team's own, reactions, and
 * GIFs. Kept apart from the conversation itself so that stays readable.
 */

export type CustomEmoji = RouterOutputs["chat"]["customEmoji"][number];

/** One reaction as stored: the emoji itself, or "custom:<id>". */
export function EmojiGlyph({ emoji, custom, size = 18 }: { emoji: string; custom: CustomEmoji[]; size?: number }) {
  if (emoji.startsWith("custom:")) {
    const found = custom.find((item) => item.id === emoji.slice("custom:".length));
    // eslint-disable-next-line @next/next/no-img-element -- a tiny data picture, nothing to optimise
    return found ? <img src={found.image} alt={`:${found.name}:`} title={`:${found.name}:`} width={size} height={size} className="inline-block" /> : <span>▫️</span>;
  }
  return <span style={{ fontSize: size * 0.9, lineHeight: 1 }}>{emoji}</span>;
}

// --- Floating panels --------------------------------------------------------------

/**
 * A panel floating beside whatever opened it, above if there is room and
 * below if not, kept inside the window. Drawn on <body>, so a scrolling
 * conversation can never cut it off.
 */
export function Floating({
  anchor,
  width,
  height,
  onClose,
  children,
}: {
  anchor: HTMLElement;
  width: number;
  height: number;
  onClose: () => void;
  children: React.ReactNode;
}) {
  const box = useRef<HTMLDivElement>(null);
  const [place, setPlace] = useState<{ left: number; top: number } | null>(null);

  useLayoutEffect(() => {
    const rect = anchor.getBoundingClientRect();
    const gap = 8;
    const above = rect.top - height - gap;
    const top = above >= 8 ? above : Math.min(window.innerHeight - height - 8, rect.bottom + gap);
    const left = Math.max(8, Math.min(window.innerWidth - width - 8, rect.right - width));
    setPlace({ left, top: Math.max(8, top) });
  }, [anchor, width, height]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    const onDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (box.current?.contains(target) || anchor.contains(target)) return;
      onClose();
    };
    window.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onDown);
    return () => {
      window.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onDown);
    };
  }, [anchor, onClose]);

  return createPortal(
    <div
      ref={box}
      style={{ left: place?.left ?? -9999, top: place?.top ?? -9999, width, maxHeight: "calc(100vh - 16px)" }}
      className="border-ink-200/60 fixed z-[1100] overflow-y-auto rounded-xl border bg-white shadow-xl"
    >
      {children}
    </div>,
    document.body,
  );
}

// --- The emoji picker -------------------------------------------------------------

/**
 * Every emoji, searchable, with the ones you use most first and the team's
 * own in a group of their own — the emoji-mart picker, drawn in our colours.
 */
export function EmojiPicker({ onPick, custom }: { onPick: (emoji: string) => void; custom: CustomEmoji[] }) {
  const holder = useRef<HTMLDivElement>(null);
  const pick = useRef(onPick);
  pick.current = onPick;
  const [adding, setAdding] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let element: HTMLElement | null = null;
    // Loaded only when a picker opens: the full emoji list is large.
    void Promise.all([import("emoji-mart"), import("@emoji-mart/data")]).then(([{ Picker }, data]) => {
      if (cancelled || !holder.current) return;
      element = new Picker({
        data: data.default,
        onEmojiSelect: (chosen: { native?: string; id: string }) => {
          const own = custom.find((item) => item.name === chosen.id);
          pick.current(own ? `custom:${own.id}` : (chosen.native ?? ""));
        },
        custom: custom.length
          ? [
              {
                id: "we-lodge",
                name: "We Lodge",
                emojis: custom.map((item) => ({ id: item.name, name: item.name, keywords: [item.name], skins: [{ src: item.image }] })),
              },
            ]
          : [],
        theme: "light",
        previewPosition: "none",
        skinTonePosition: "search",
        maxFrequentRows: 2,
        perLine: 8,
        set: "native",
      }) as unknown as HTMLElement;
      // The picker's accent, in the brand purple.
      element.style.setProperty("--rgb-accent", "171, 108, 226");
      element.style.setProperty("--shadow", "none");
      element.style.setProperty("--border-radius", "12px");
      holder.current.appendChild(element);
    });
    return () => {
      cancelled = true;
      element?.remove();
    };
  }, [custom]);

  return (
    <div>
      {/* Hidden, not removed, while adding one — so it does not load again. */}
      <div ref={holder} className={adding ? "hidden" : "min-h-[380px]"} />
      <div className={adding ? "p-4" : "border-ink-200/60 border-t px-3 py-2"}>
        {adding ? (
          <>
            <p className="text-ink-900 mb-1 text-[13px] font-medium">A We Lodge emoji</p>
            <p className="text-ink-500 mb-3 text-xs font-light">
              A picture and a short name. Everyone on the team can then react with it.
            </p>
            <AddCustomEmoji onDone={() => setAdding(false)} />
          </>
        ) : (
          <button type="button" onClick={() => setAdding(true)} className="text-brand-700 text-xs font-medium hover:underline">
            + Add a We Lodge emoji
          </button>
        )}
      </div>
    </div>
  );
}

/**
 * The team's own emoji: a name and a picture, shrunk here to a small square
 * before it is sent, so it is kilobytes, not megabytes.
 */
function AddCustomEmoji({ onDone }: { onDone: () => void }) {
  const utils = api.useUtils();
  const [name, setName] = useState("");
  const [image, setImage] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const add = api.chat.addCustomEmoji.useMutation({
    onSuccess: () => {
      void utils.chat.customEmoji.invalidate();
      onDone();
    },
  });

  const read = (file: File) => {
    setProblem(null);
    if (!file.type.startsWith("image/")) return setProblem("Choose a picture — PNG, JPG or GIF.");
    const picture = new Image();
    picture.onload = () => {
      const size = 64;
      const canvas = document.createElement("canvas");
      canvas.width = size;
      canvas.height = size;
      const context = canvas.getContext("2d")!;
      // Fitted inside the square, never cropped.
      const scale = Math.min(size / picture.width, size / picture.height);
      const w = picture.width * scale;
      const h = picture.height * scale;
      context.drawImage(picture, (size - w) / 2, (size - h) / 2, w, h);
      setImage(canvas.toDataURL("image/png"));
      URL.revokeObjectURL(picture.src);
    };
    picture.onerror = () => setProblem("That picture could not be read.");
    picture.src = URL.createObjectURL(file);
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <label className="border-ink-200 hover:border-brand-400 flex h-10 w-10 shrink-0 cursor-pointer items-center justify-center rounded-lg border border-dashed">
          {/* eslint-disable-next-line @next/next/no-img-element -- a tiny data picture */}
          {image ? <img src={image} alt="" width={28} height={28} /> : <span className="text-ink-400 text-lg">+</span>}
          <input type="file" accept="image/*" className="hidden" aria-label="Picture" onChange={(e) => e.target.files?.[0] && read(e.target.files[0])} />
        </label>
        <Input
          value={name}
          onChange={(e) => setName(e.target.value.toLowerCase().replace(/\s+/g, "-"))}
          placeholder="Name, like welodge"
          aria-label="Emoji name"
          className="py-1.5 text-[13px]"
        />
      </div>
      {(problem ?? add.error) && <p className="text-xs text-[#c03654]">{problem ?? add.error?.message}</p>}
      <div className="flex gap-2">
        <Button
          type="button"
          className="px-3 py-1 text-xs"
          disabled={!image || !name.trim() || add.isPending}
          onClick={() => image && add.mutate({ name, image })}
        >
          {add.isPending ? "Adding…" : "Add emoji"}
        </Button>
        <Button type="button" variant="ghost" className="px-3 py-1 text-xs" onClick={onDone}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

// --- Reactions under a message ----------------------------------------------------

type Reaction = { emoji: string; userId: string; user: { name: string | null; email: string | null } };

/** Each emoji once, with how many gave it and who; yours is outlined, and clicking it takes it back. */
export function ReactionChips({
  reactions,
  myId,
  custom,
  onToggle,
}: {
  reactions: Reaction[];
  myId: string;
  custom: CustomEmoji[];
  onToggle: (emoji: string) => void;
}) {
  if (reactions.length === 0) return null;
  const groups = new Map<string, Reaction[]>();
  for (const reaction of reactions) groups.set(reaction.emoji, [...(groups.get(reaction.emoji) ?? []), reaction]);
  return (
    <div className="mt-1 flex flex-wrap gap-1 px-1">
      {[...groups].map(([emoji, people]) => {
        const mine = people.some((person) => person.userId === myId);
        const names = people.map((person) =>
          person.userId === myId ? "You" : (person.user.name ?? person.user.email ?? "Someone").split(" ")[0],
        );
        return (
          <button
            key={emoji}
            type="button"
            onClick={() => onToggle(emoji)}
            title={`${names.join(", ")} reacted`}
            aria-pressed={mine}
            className={`flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs transition-colors ${
              mine ? "border-brand-400 bg-brand-50 text-brand-800" : "border-ink-200 text-ink-700 bg-white hover:border-ink-300"
            }`}
          >
            <EmojiGlyph emoji={emoji} custom={custom} size={16} />
            <span className="font-medium">{people.length}</span>
          </button>
        );
      })}
    </div>
  );
}

// --- GIFs --------------------------------------------------------------------------

export type Gif = { url: string; width: number; height: number; title?: string };

/** Trending GIFs, or a search, from GIPHY; clicking one sends it. */
export function GifPicker({ onPick }: { onPick: (gif: Gif) => void }) {
  const [typed, setTyped] = useState("");
  const [q, setQ] = useState("");
  useEffect(() => {
    const timer = setTimeout(() => setQ(typed), 300);
    return () => clearTimeout(timer);
  }, [typed]);
  const gifs = api.chat.gifs.useQuery({ q }, { placeholderData: keepPreviousData, staleTime: 60_000 });

  return (
    <div className="flex h-[420px] flex-col p-3">
      <Input type="search" value={typed} onChange={(e) => setTyped(e.target.value)} placeholder="Search GIFs" aria-label="Search GIFs" autoFocus />
      <div className="mt-2 flex gap-1.5 overflow-x-auto pb-1">
        {["Trending", "thank you", "wow", "yes", "oops", "haha", "congrats"].map((tag) => {
          const value = tag === "Trending" ? "" : tag;
          return (
            <button
              key={tag}
              type="button"
              onClick={() => setTyped(value)}
              className={`shrink-0 rounded-full border px-2.5 py-0.5 text-xs ${
                typed === value ? "border-brand-400 bg-brand-50 text-brand-800" : "border-ink-200 text-ink-700"
              }`}
            >
              {tag === "Trending" ? tag : `#${tag}`}
            </button>
          );
        })}
      </div>
      <div className="mt-2 min-h-0 flex-1 overflow-y-auto">
        {gifs.data && !gifs.data.configured ? (
          <p className="text-ink-500 p-3 text-center text-[13px] font-light">
            GIFs need a GIPHY key on the system first — see docs/todos.md.
          </p>
        ) : gifs.error ? (
          <p className="p-3 text-center text-[13px] text-[#c03654]">{gifs.error.message}</p>
        ) : !gifs.data ? (
          <p className="text-ink-500 p-3 text-center text-[13px] font-light">Loading…</p>
        ) : gifs.data.gifs.length === 0 ? (
          <p className="text-ink-500 p-3 text-center text-[13px] font-light">No GIFs for that. Try another word.</p>
        ) : (
          <div className="columns-2 gap-1.5">
            {gifs.data.gifs.map((gif) => (
              <button
                key={gif.id}
                type="button"
                onClick={() => onPick(gif)}
                className="mb-1.5 block w-full overflow-hidden rounded-lg"
                title={gif.title}
              >
                {/* eslint-disable-next-line @next/next/no-img-element -- GIPHY's own animated picture */}
                <img src={gif.url} alt={gif.title} width={gif.width} height={gif.height} loading="lazy" className="h-auto w-full" />
              </button>
            ))}
          </div>
        )}
      </div>
      {/* GIPHY's terms ask for this wherever its GIFs are searched. */}
      <p className="text-ink-400 mt-2 text-right text-[10px] tracking-wide uppercase">Powered by GIPHY</p>
    </div>
  );
}
