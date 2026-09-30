"use client";

import Link from "next/link";
import { useEffect } from "react";
import { createPortal } from "react-dom";

import { daysUntil } from "~/lib/dates";
import { isClosed } from "~/lib/sales";
import { api } from "~/trpc/react";

/**
 * The sales side from anywhere (doc §4.10, §4.11), opened from the menu like
 * Events: the requests, with what needs chasing, and the contacts.
 */
export function SalesPanel({ onClose }: { onClose: () => void }) {
  const open = api.sales.list.useQuery({ show: "open" });

  useEffect(() => {
    const onEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onEscape);
    return () => window.removeEventListener("keydown", onEscape);
  }, [onClose]);

  const requests = open.data ?? [];
  const due = requests.filter(
    (request) => !isClosed(request.stage) && request.followUpOn && daysUntil(request.followUpOn) <= 0,
  ).length;

  const row = (href: string, title: string, detail: React.ReactNode) => (
    <li>
      <Link href={href} onClick={onClose} className="hover:bg-ink-50 block rounded-lg px-3 py-2.5 transition-colors">
        <span className="text-ink-900 block text-sm font-medium">{title}</span>
        <span className="text-ink-500 mt-0.5 block text-xs font-light">{detail}</span>
      </Link>
    </li>
  );

  // Portalled onto <body> for the same reason as the Events panel: the
  // sidebar is sticky, and nothing nested in it can paint above the page.
  return createPortal(
    <>
      <div className="fixed inset-0 z-[1010] bg-black/20" onClick={onClose} aria-hidden="true" />
      <div className="border-ink-200/60 fixed inset-y-0 left-0 z-[1020] flex w-full max-w-sm flex-col border-r bg-white shadow-xl md:left-60">
        <div className="border-ink-200/60 flex items-start justify-between gap-3 border-b p-5">
          <div>
            <h2 className="text-ink-900 text-[15px] font-medium">Sales</h2>
            <p className="text-ink-500 mt-0.5 text-xs font-light">
              What our clients have asked for, and the clients themselves.
            </p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="text-ink-400 hover:text-ink-700">
            ✕
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5">
          {due > 0 && (
            <Link
              href="/sales"
              onClick={onClose}
              className="mb-4 block rounded-lg border border-[#c03654]/30 bg-[#fde8ec]/60 px-3 py-2.5 transition-colors hover:border-[#c03654]/60"
            >
              <span className="block text-[11px] font-medium tracking-wider text-[#a3243d] uppercase">Follow up</span>
              <span className="text-ink-900 mt-1 block text-sm font-medium">
                {due} request{due === 1 ? " is" : "s are"} due today or overdue
              </span>
            </Link>
          )}
          <ul className="space-y-1">
            {row(
              "/sales",
              "Requests",
              open.isLoading
                ? "Every client's interest, from first enquiry to signed"
                : `${requests.length} open · every client's interest, from first enquiry to signed`,
            )}
            {row("/clients", "Clients", "The companies we sell to and the people there — search by company or by person")}
          </ul>
        </div>

        <div className="border-ink-200/60 flex items-center justify-between gap-3 border-t p-5">
          <Link
            href="/sales/new"
            onClick={onClose}
            className="bg-brand-400 hover:bg-brand-500 rounded-full px-4 py-2 text-[13px] font-medium text-white"
          >
            + New sales request
          </Link>
        </div>
      </div>
    </>,
    document.body,
  );
}
