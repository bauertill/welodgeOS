import { useEffect, useRef, useState } from "react";

/**
 * A filter that stays as it was set until it is reset (the team, 2026-11-12:
 * "can we keep the same filter until we reset?") — kept in this browser, for
 * this person, so leaving a page and coming back finds it unchanged. Read after
 * the page has loaded (storage only exists in the browser); without storage
 * (private browsing) it simply starts from the default each time.
 */
export function useRemembered<T>(
  key: string,
  initial: T,
  /** What a link asked for — it wins over what was kept, and is kept from then on. */
  prefer?: T,
): [T, (value: T | ((current: T) => T)) => void, boolean] {
  const [value, setValue] = useState<T>(initial);
  const [restored, setRestored] = useState(false);
  const storageKey = `welodge:filter:${key}`;
  const first = useRef(true);

  useEffect(() => {
    try {
      if (prefer !== undefined) {
        setValue(prefer);
        window.localStorage.setItem(storageKey, JSON.stringify(prefer));
      } else {
        const saved = window.localStorage.getItem(storageKey);
        if (saved !== null) setValue(JSON.parse(saved) as T);
      }
    } catch {
      // No storage, or something unreadable in it: the default.
    }
    setRestored(true);
    // Only when the page opens: a link's wish is read once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storageKey]);

  useEffect(() => {
    if (!restored) return;
    if (first.current) {
      first.current = false;
      return;
    }
    try {
      window.localStorage.setItem(storageKey, JSON.stringify(value));
    } catch {
      // Nowhere to keep it: it lasts as long as the page.
    }
  }, [restored, storageKey, value]);

  return [value, setValue, restored];
}
