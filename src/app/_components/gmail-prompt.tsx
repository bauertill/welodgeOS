"use client";

import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

import { isPublicPath, useIsAuthRoute } from "~/app/_components/nav";
import { api } from "~/trpc/react";

const snoozeKey = "welodge.gmailPrompt.snoozedUntil";
const snoozeMs = 24 * 60 * 60 * 1000;

function snoozed() {
  try {
    return Number(window.localStorage.getItem(snoozeKey) ?? 0) > Date.now();
  } catch {
    return false;
  }
}

/**
 * Connect Gmail (doc §4.10), brought to people instead of waiting on My
 * profile: a card in the corner of every page until their Gmail is connected
 * (the owner, 2026-11-10: "it's lost in the profile page"). *Not now* puts it
 * away for a day, in that browser only. Not shown on My profile, which has the
 * full Gmail card, nor while Gmail is not switched on for the system.
 */
export function GmailPrompt() {
  const pathname = usePathname();
  const authRoute = useIsAuthRoute();
  const mine = api.email.mine.useQuery(undefined, { retry: false, refetchOnWindowFocus: false });
  // Read after mounting: the server has no browser storage to read.
  const [hidden, setHidden] = useState(true);
  useEffect(() => setHidden(snoozed()), []);

  if (hidden || authRoute || isPublicPath(pathname) || pathname.startsWith("/team/profile")) return null;
  if (!mine.data?.configured || mine.data.connection) return null;

  const notNow = () => {
    try {
      window.localStorage.setItem(snoozeKey, String(Date.now() + snoozeMs));
    } catch {
      // Private browsing: it is put away until the page is reloaded.
    }
    setHidden(true);
  };

  return (
    <div
      role="dialog"
      aria-labelledby="gmail-prompt-title"
      className="border-ink-200/60 fixed right-4 bottom-4 left-4 z-[1000] rounded-2xl border bg-white p-5 shadow-2xl sm:left-auto sm:w-96 print:hidden"
    >
      <div className="flex items-start gap-4">
        <span aria-hidden="true" className="bg-brand-50 text-brand-700 flex h-10 w-10 shrink-0 items-center justify-center rounded-full">
          <svg viewBox="0 0 20 20" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.6">
            <rect x="2.5" y="4.5" width="15" height="11" rx="2" />
            <path d="m3 5.5 7 5.5 7-5.5" strokeLinejoin="round" />
          </svg>
        </span>
        <div className="min-w-0">
          <h2 id="gmail-prompt-title" className="text-ink-900 text-[15px] font-medium">
            Connect your Gmail
          </h2>
          <p className="text-ink-500 mt-1 text-[13px] font-light">
            Your emails with clients then show on their requests and pages, for the whole team. Read-only — nothing is ever sent, changed or deleted.
          </p>
          <div className="mt-4 flex items-center gap-4">
            <a href="/api/gmail/connect" className="bg-brand-400 hover:bg-brand-500 rounded-full px-5 py-2 text-[13px] font-medium text-white">
              Connect Gmail
            </a>
            <button type="button" onClick={notNow} className="text-ink-500 hover:text-ink-700 text-[13px] font-light">
              Not now
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
