"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { formatMomentInWords } from "~/lib/format";
import { api } from "~/trpc/react";

/**
 * The bell in the header (doc §2.9): how many notifications are unread, and
 * the latest of them. Opening one marks it read and goes to what it is about;
 * the dot beside each marks it read, or unread again, without opening it (2026-11-27).
 * Checks for new ones every half minute.
 */
export function NotificationBell() {
  const router = useRouter();
  const utils = api.useUtils();
  const mine = api.notification.mine.useQuery(undefined, { refetchInterval: 30_000 });
  // Keep their time zone as the browser reports it, so the morning summary comes at 7:00 their time.
  const summary = api.notification.summary.useQuery(undefined, { staleTime: 10 * 60_000 });
  const setZone = api.notification.setTimeZone.useMutation();
  useEffect(() => {
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (summary.data && zone && summary.data.timeZone !== zone && !setZone.isPending && !setZone.isSuccess) setZone.mutate({ timeZone: zone });
  }, [summary.data, setZone]);
  const markRead = api.notification.markRead.useMutation({ onSuccess: () => void utils.notification.invalidate() });
  // Read or unread from the dot, at once — the list changes before the server answers.
  const setRead = (id: string, read: boolean) => {
    utils.notification.mine.setData(undefined, (data) =>
      data
        ? {
            unread: Math.max(0, data.unread + (read ? -1 : 1)),
            items: data.items.map((one) => (one.id === id ? { ...one, readAt: read ? new Date() : null } : one)),
          }
        : data,
    );
    if (read) markRead.mutate({ id });
    else markUnread.mutate({ id });
  };
  const markUnread = api.notification.markUnread.useMutation({ onSuccess: () => void utils.notification.invalidate() });
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
                <li key={item.id} className={`group relative ${item.readAt ? "" : "bg-brand-50/50"}`}>
                  <button
                    type="button"
                    onClick={() => {
                      if (!item.readAt) markRead.mutate({ id: item.id });
                      setOpen(false);
                      router.push(item.link);
                    }}
                    className="hover:bg-ink-50 flex w-full gap-3 py-3 pr-4 pl-9 text-left"
                  >
                    <span className="min-w-0">
                      <span className={`text-ink-900 block text-[13px] ${item.readAt ? "font-light" : "font-medium"}`}>{item.title}</span>
                      {item.body && <span className="text-ink-500 mt-0.5 line-clamp-2 block text-xs font-light whitespace-pre-line">{item.body}</span>}
                      <span className="text-ink-400 mt-1 block text-[11px] font-light">{formatMomentInWords(item.createdAt)}</span>
                    </span>
                  </button>
                  {!item.readAt && (
                    <button
                      type="button"
                      onClick={() => setRead(item.id, true)}
                      className="text-brand-700 absolute right-4 bottom-2.5 text-[11px] font-medium hover:underline"
                    >
                      Mark as read
                    </button>
                  )}
                  {/* The dot: read or unread, without opening it (2026-11-27). */}
                  <button
                    type="button"
                    onClick={() => setRead(item.id, !item.readAt)}
                    title={item.readAt ? "Mark as unread" : "Mark as read"}
                    aria-label={`${item.readAt ? "Mark as unread" : "Mark as read"}: ${item.title}`}
                    className="hover:bg-brand-100 absolute top-2 left-1.5 flex h-7 w-7 items-center justify-center rounded-full"
                  >
                    <span
                      className={`h-2.5 w-2.5 rounded-full ${item.readAt ? "border-ink-200 border bg-transparent opacity-0 group-hover:opacity-100 [@media(hover:none)]:opacity-100" : "bg-brand-400"}`}
                      aria-hidden
                    />
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

/**
 * Only mentions are emailed (the owner, 2026-11-17), so the choice is simply
 * yes or no. "At once" and the old "Daily summary" both count as yes.
 */
const preferences = [
  { value: "IMMEDIATE", label: "Email me when I'm mentioned", hint: "An email as soon as someone @mentions you in an update, a reply or a task." },
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
        When someone @mentions you, an email at once. Everything else — tasks given to you, comments, replies, deadlines — is in the bell at
        the top, and in the morning summary below.
      </p>
      <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Notifications by email">
        {preferences.map((option) => {
          const chosen = option.value === "NONE" ? current.data === "NONE" : current.data !== undefined && current.data !== "NONE";
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
      <SummaryChoice />
    </div>
  );
}

/** The morning summary at 7:00 their own time (the owner, 2026-11-17). */
function SummaryChoice() {
  const utils = api.useUtils();
  const summary = api.notification.summary.useQuery();
  const save = api.notification.setSummary.useMutation({ onSuccess: () => void utils.notification.summary.invalidate() });
  const zone = summary.data?.timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
  return (
    <label className="border-ink-200/60 mt-4 flex cursor-pointer items-start gap-3 border-t pt-4">
      <input
        type="checkbox"
        className="accent-brand-500 mt-0.5 h-4 w-4"
        checked={summary.data?.dailySummary ?? true}
        disabled={!summary.data || save.isPending}
        onChange={(e) => save.mutate({ on: e.target.checked })}
      />
      <span>
        <span className="text-ink-900 block text-[13px] font-medium">A morning summary at 7:00</span>
        <span className="text-ink-500 block text-xs font-light">
          One email each morning with what is still unread in your bell since the day before — nothing on a quiet day. At 7:00 your time ({zone.replace(/_/g, " ")}).
        </span>
      </span>
    </label>
  );
}
