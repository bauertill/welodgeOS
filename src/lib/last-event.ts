"use client";

/**
 * Where the user last was inside an event, so the "Events" nav link can drop
 * them back into the event and tab they were working in rather than resetting
 * to the events list every time they glance at Properties or Clients (doc §7).
 */
const KEY = "welodge:last-event-path";

export function setLastEventPath(pathname: string) {
  try {
    window.localStorage.setItem(KEY, pathname);
  } catch {
    // Private browsing or storage disabled — losing this is a convenience,
    // not a correctness problem, so fail silently.
  }
}

export function getLastEventPath(): string | null {
  try {
    return window.localStorage.getItem(KEY);
  } catch {
    return null;
  }
}
