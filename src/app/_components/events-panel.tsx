"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { NewEventPanel } from "~/app/_components/event-form";
import { formatRange } from "~/lib/format";
import { getLastEventPath } from "~/lib/last-event";
import { api } from "~/trpc/react";

const statusLabels = {
  PLANNING: "Planning",
  ACTIVE: "Active",
  CLOSED: "Closed",
} as const;

const tabLabels: Record<string, string> = {
  inventory: "Inventory",
  deadlines: "Deadlines",
  position: "Position",
};

/**
 * Switching events from anywhere, without losing the page you are on. Every
 * row lands on Inventory, which is what an event is opened for day to day —
 * scouting is managed from the property now, not from inside an event
 * (doc §3.5).
 */
export function EventsPanel({ onClose }: { onClose: () => void }) {
  const events = api.event.list.useQuery();
  const [lastPath, setLastPath] = useState<string | null>(null);

  // localStorage only exists in the browser, so this is read after mount.
  useEffect(() => setLastPath(getLastEventPath()), []);

  useEffect(() => {
    const onEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onEscape);
    return () => window.removeEventListener("keydown", onEscape);
  }, [onClose]);

  const rows = events.data ?? [];

  // "/events/<id>/<tab>" — resolved against the list so the link can name the
  // event rather than showing a path.
  const lastSegments = lastPath?.split("/").filter(Boolean) ?? [];
  const lastEvent =
    lastSegments[0] === "events"
      ? rows.find((event) => event.id === lastSegments[1])
      : undefined;
  const lastTab = lastSegments[2] ? tabLabels[lastSegments[2]] : undefined;

  return (
    <>
      <div
        className="fixed inset-0 z-[1010] bg-black/20"
        onClick={onClose}
        aria-hidden="true"
      />
      {/* Above Leaflet's own panes and controls, which reach z-index 1000
          on the Properties map — a plain z-40 sat underneath them. */}
      <div className="border-ink-200/60 fixed inset-y-0 left-0 z-[1020] flex w-full max-w-sm flex-col border-r bg-white shadow-xl md:left-60">
        <div className="border-ink-200/60 flex items-start justify-between gap-3 border-b p-5">
          <div>
            <h2 className="text-ink-900 text-[15px] font-medium">Events</h2>
            <p className="text-ink-500 mt-0.5 text-xs font-light">
              Every championship, congress or tour we are finding
              accommodation for.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="text-ink-400 hover:text-ink-700"
          >
            ✕
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5">
          {lastEvent && lastPath && (
            <Link
              href={lastPath}
              onClick={onClose}
              className="border-brand-400/40 bg-brand-50/60 hover:border-brand-400 mb-4 block rounded-lg border px-3 py-2.5 transition-colors"
            >
              <span className="text-ink-500 block text-[11px] font-medium tracking-wider uppercase">
                Pick up where you left off
              </span>
              <span className="text-ink-900 mt-1 block text-sm font-medium">
                {lastEvent.name}
                {lastTab ? ` · ${lastTab}` : ""}
              </span>
            </Link>
          )}

          {events.isLoading ? (
            <p className="text-ink-500 text-sm font-light">Loading…</p>
          ) : rows.length === 0 ? (
            <p className="text-ink-500 text-sm font-light">
              No events yet. Create one below — an event is the container
              everything else hangs off.
            </p>
          ) : (
            <ul className="space-y-1">
              {rows.map((event) => (
                <li key={event.id}>
                  <Link
                    href={`/events/${event.id}/inventory`}
                    onClick={onClose}
                    className="hover:bg-ink-50 block rounded-lg px-3 py-2.5 transition-colors"
                  >
                    <span className="text-ink-900 block text-sm font-medium">
                      {event.name}
                    </span>
                    <span className="text-ink-500 mt-0.5 block text-xs font-light">
                      {formatRange(event.startDate, event.endDate)}
                      {event.city ? ` · ${event.city}` : ""} ·{" "}
                      {statusLabels[event.status]}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="border-ink-200/60 flex items-center justify-between gap-3 border-t p-5">
          <NewEventPanel />
          <Link
            href="/events"
            onClick={onClose}
            className="text-brand-700 hover:text-brand-400 text-[13px]"
          >
            All events →
          </Link>
        </div>
      </div>
    </>
  );
}
