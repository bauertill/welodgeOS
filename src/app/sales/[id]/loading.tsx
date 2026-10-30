/**
 * Shown the moment a request is opened — straight after registering one too —
 * while its page is put together, so it is clear something is happening
 * (2026-10-30: a new request seemed not to open, and was looked for elsewhere).
 */
export default function Loading() {
  return <p className="text-ink-500 px-1 py-10 text-sm font-light">Opening the request…</p>;
}
