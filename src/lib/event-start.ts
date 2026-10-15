"use client";

/**
 * Which tab an event opens on (doc §3.10, 2026-10-13): Properties, unless the
 * person chose another. The system notices — in this browser — when someone
 * opens an event and goes straight to the same other tab three times running,
 * and offers to make it their start; a "no" is not asked again for that tab.
 */

/** The event's tabs by their address: "" is Properties. */
export const eventTabSlugs = ["", "inventory", "deadlines", "position", "details"] as const;
export type EventTabSlug = (typeof eventTabSlugs)[number];
export const eventTabLabels: Record<EventTabSlug, string> = {
  "": "Properties",
  inventory: "Inventory",
  deadlines: "Deadlines",
  position: "Position",
  details: "Event details",
};
export const isEventTab = (value: string | null | undefined): value is EventTabSlug =>
  typeof value === "string" && eventTabSlugs.includes(value as EventTabSlug);

export const eventHref = (eventId: string, tab: string | null | undefined) => {
  const slug = isEventTab(tab) ? tab : "";
  return slug ? `/events/${eventId}/${slug}` : `/events/${eventId}`;
};

const OPENED = "welodge:event-opened";
const HISTORY = "welodge:event-open-history";
const DISMISSED = "welodge:event-tab-dismissed";
const RUN = 3;

const read = <T,>(storage: Storage, key: string, fallback: T): T => {
  try {
    const raw = storage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
};
const write = (storage: Storage, key: string, value: unknown) => {
  try {
    storage.setItem(key, JSON.stringify(value));
  } catch {
    // Private browsing or storage off: noticing habits is a convenience.
  }
};

/** An event was opened from a list: what happens next is noted, once. */
export function markEventOpened(eventId: string) {
  write(window.sessionStorage, OPENED, { eventId, landed: null as string | null });
  const history = read<(string | null)[]>(window.localStorage, HISTORY, []);
  write(window.localStorage, HISTORY, [...history, null].slice(-10));
}

/** Seen from the event's tabs as the address changes: the landing, then the first move. */
export function noteEventTab(eventId: string, slug: EventTabSlug) {
  const opened = read<{ eventId: string; landed: string | null } | null>(window.sessionStorage, OPENED, null);
  if (!opened || opened.eventId !== eventId) return;
  if (opened.landed === null) {
    write(window.sessionStorage, OPENED, { eventId, landed: slug });
    return;
  }
  if (opened.landed === slug) return;
  // The first move away from where it opened.
  const history = read<(string | null)[]>(window.localStorage, HISTORY, []);
  if (history.length) history[history.length - 1] = slug;
  write(window.localStorage, HISTORY, history);
  try {
    window.sessionStorage.removeItem(OPENED);
  } catch {
    // As above.
  }
}

/** The tab to offer as their start — gone to straight away the last three opens — or null. */
export function suggestedStartTab(current: EventTabSlug): EventTabSlug | null {
  const history = read<(string | null)[]>(window.localStorage, HISTORY, []).slice(-RUN);
  if (history.length < RUN) return null;
  const first = history[0];
  if (first === null || first === undefined || !isEventTab(first) || first === current) return null;
  if (!history.every((tab) => tab === first)) return null;
  if (read<string[]>(window.localStorage, DISMISSED, []).includes(first)) return null;
  return first;
}

/** "No, thanks": not asked again for this tab. */
export function dismissStartTab(slug: EventTabSlug) {
  write(window.localStorage, DISMISSED, [...new Set([...read<string[]>(window.localStorage, DISMISSED, []), slug])]);
}

/** Asked and answered: start counting afresh. */
export function clearEventHistory() {
  write(window.localStorage, HISTORY, []);
}
