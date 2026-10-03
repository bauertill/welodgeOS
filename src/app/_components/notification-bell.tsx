"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { formatMomentInWords } from "~/lib/format";
import { api } from "~/trpc/react";

/**
 * The bell in the header (doc §2.9): how many notifications are unread, and
 * the latest of them. Opening one marks it read and goes to what it is about.
 * Checks for new ones every half minute.
 */
export function NotificationBell() {
  const router = useRouter();
  const utils = api.useUtils();
  const mine = api.notification.mine.useQuery(undefined, { refetchInterval: 30_000 });
  const markRead = api.notification.markRead.useMutation({ onSuccess: () => void utils.notification.invalidate() });
  const markAll = api.notification.markAllRead.useMutation({ onSuccess: () => void utils.notification.invalidate() });
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent) => {
      if (box.current && !box.current.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  const unread = mine.data?.unread ?? 0;
  const items = mine.data?.items ?? [];

  return (
    <div ref={box} className="relative">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-label={unread ? `Notifications, ${unread} unread` : "Notifications"}
        aria-expanded={open}
        className="relative flex h-9 w-9 items-center justify-center rounded-full text-white/80 transition-colors hover:bg-white/10 hover:text-white"
      >
        <svg viewBox="0 0 24 24" fill="none" className="h-5 w-5" aria-hidden>
          <path
            d="M6 8a6 6 0 1 1 12 0c0 7 3 9 3 9H3s3-2 3-9M10.3 21a1.94 1.94 0 0 0 3.4 0"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
        {unread > 0 && (
          <span className="absolute -top-0.5 -right-0.5 min-w-[18px] rounded-full bg-[#db4b68] px-1 text-center text-[10px] leading-[18px] font-semibold text-white">
            {unread > 99 ? "99+" : unread}
          </span>
        )}
      </button>
      {open && (
        <div className="border-ink-200 absolute right-0 z-[1030] mt-2 w-96 max-w-[calc(100vw-2rem)] overflow-hidden rounded-xl border bg-white shadow-xl">
          <div className="border-ink-200/60 flex items-center justify-between border-b px-4 py-2.5">
            <span className="text-ink-900 text-[14px] font-medium">Notifications</span>
            {unread > 0 && (
              <button type="button" onClick={() => markAll.mutate()} className="text-brand-700 text-xs font-light hover:underline">
                Mark all read
              </button>
            )}
          </div>
          {items.length === 0 ? (
            <p className="text-ink-500 px-4 py-6 text-center text-sm font-light">Nothing yet.</p>
          ) : (
            <ul className="divide-ink-200/60 max-h-[70vh] divide-y overflow-y-auto">
              {items.map((item) => (
                <li key={item.id}>
                  <button
                    type="button"
                    onClick={() => {
                      if (!item.readAt) markRead.mutate({ id: item.id });
                      setOpen(false);
                      router.push(item.link);
                    }}
                    className={`hover:bg-ink-50 flex w-full gap-3 px-4 py-3 text-left ${item.readAt ? "" : "bg-brand-50/50"}`}
                  >
                    <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${item.readAt ? "bg-transparent" : "bg-brand-400"}`} aria-hidden />
                    <span className="min-w-0">
                      <span className={`text-ink-900 block text-[13px] ${item.readAt ? "font-light" : "font-medium"}`}>{item.title}</span>
                      {item.body && <span className="text-ink-500 mt-0.5 line-clamp-2 block text-xs font-light whitespace-pre-line">{item.body}</span>}
                      <span className="text-ink-400 mt-1 block text-[11px] font-light">{formatMomentInWords(item.createdAt)}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

const preferences = [
  { value: "IMMEDIATE", label: "At once", hint: "An email for each, as it happens." },
  { value: "DAILY", label: "Daily summary", hint: "One email each morning with everything since the last." },
  { value: "NONE", label: "No email", hint: "Only the bell in the app." },
] as const;

/** On My profile: how you get notifications by email. */
export function EmailPreferenceCard() {
  const utils = api.useUtils();
  const current = api.notification.emailPreference.useQuery();
  const save = api.notification.setEmailPreference.useMutation({ onSuccess: () => void utils.notification.emailPreference.invalidate() });
  return (
    <div className="border-ink-200/60 mb-8 rounded-xl border bg-white p-5">
      <h2 className="text-ink-900 text-[15px] font-medium">Notifications by email</h2>
      <p className="text-ink-500 mt-1 mb-3 text-sm font-light">
        When you are given a task, mentioned, a task of yours is commented on or moved, or one is due tomorrow or overdue. The bell at the top
        always shows them.
      </p>
      <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Notifications by email">
        {preferences.map((option) => {
          const chosen = current.data === option.value;
          return (
            <button
              key={option.value}
              type="button"
              role="radio"
              aria-checked={chosen}
              disabled={save.isPending}
              onClick={() => save.mutate({ preference: option.value })}
              className={`rounded-lg border px-4 py-2.5 text-left transition-colors ${
                chosen ? "border-brand-400 bg-brand-50" : "border-ink-200 hover:border-brand-300 bg-white"
              }`}
            >
              <span className={`block text-[13px] ${chosen ? "text-brand-800 font-medium" : "text-ink-900"}`}>{option.label}</span>
              <span className="text-ink-500 block text-xs font-light">{option.hint}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
