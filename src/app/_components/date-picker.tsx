"use client";

import { useEffect, useRef, useState } from "react";

/**
 * A date to pick on a small calendar that opens on the month that matters —
 * the event's, say — rather than today's, which a browser's own date box
 * always does when it is empty (doc §4.11). Kept as "2028-07-10", or "".
 */
export function DatePicker({
  value,
  onChange,
  openAt,
  ariaLabel,
}: {
  value: string;
  onChange: (value: string) => void;
  /** "2028-07-10": the month shown when nothing is chosen yet. */
  openAt?: string | null;
  ariaLabel: string;
}) {
  const [open, setOpen] = useState(false);
  const start = value || openAt || new Date().toISOString().slice(0, 10);
  const [month, setMonth] = useState(() => monthOf(start));
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open) setMonth(monthOf(value || openAt || new Date().toISOString().slice(0, 10)));
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps -- reopened where it matters
  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent) => {
      if (box.current && !box.current.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  const [year, monthIndex] = month;
  const first = new Date(Date.UTC(year, monthIndex, 1));
  const days = new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
  // Weeks start on Monday.
  const lead = (first.getUTCDay() + 6) % 7;
  const key = (day: number) => `${year}-${String(monthIndex + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  const step = (by: number) => setMonth(([y, m]) => [m + by < 0 ? y - 1 : m + by > 11 ? y + 1 : y, (m + by + 12) % 12]);

  return (
    <div ref={box} className="relative">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-label={ariaLabel}
        aria-expanded={open}
        data-value={value}
        className="border-ink-200 focus:border-brand-400 focus:ring-brand-400/20 flex w-full items-center justify-between gap-2 rounded-lg border bg-white px-2.5 py-2 text-left text-sm font-light outline-none focus:ring-4"
      >
        <span className={value ? "text-ink-900" : "text-ink-400"}>{value ? readable(value) : "Choose"}</span>
        <svg viewBox="0 0 20 20" fill="none" className="text-ink-400 h-4 w-4 shrink-0" aria-hidden>
          <rect x="3" y="4.5" width="14" height="12" rx="2" stroke="currentColor" strokeWidth="1.4" />
          <path d="M3 8h14M7 3v3M13 3v3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
        </svg>
      </button>
      {open && (
        <div className="border-ink-200 absolute z-40 mt-1 w-64 rounded-xl border bg-white p-3 shadow-xl" role="dialog" aria-label={ariaLabel}>
          <div className="mb-2 flex items-center justify-between">
            <button type="button" onClick={() => step(-1)} aria-label="Previous month" className="text-ink-500 hover:bg-ink-50 rounded-md px-2 py-1">
              ‹
            </button>
            <span className="text-ink-900 text-[13px] font-medium">
              {first.toLocaleString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" })}
            </span>
            <button type="button" onClick={() => step(1)} aria-label="Next month" className="text-ink-500 hover:bg-ink-50 rounded-md px-2 py-1">
              ›
            </button>
          </div>
          <div className="text-ink-400 grid grid-cols-7 text-center text-[10px] font-medium">
            {["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"].map((day) => (
              <span key={day} className="py-1">
                {day}
              </span>
            ))}
          </div>
          <div className="grid grid-cols-7 gap-0.5 text-center text-[13px]">
            {Array.from({ length: lead }, (_, i) => (
              <span key={`lead-${i}`} />
            ))}
            {Array.from({ length: days }, (_, i) => {
              const day = key(i + 1);
              const chosen = day === value;
              return (
                <button
                  key={day}
                  type="button"
                  onClick={() => {
                    onChange(day);
                    setOpen(false);
                  }}
                  aria-label={readable(day)}
                  aria-pressed={chosen}
                  className={`rounded-md py-1.5 ${chosen ? "bg-brand-400 font-medium text-white" : "text-ink-700 hover:bg-brand-50"}`}
                >
                  {i + 1}
                </button>
              );
            })}
          </div>
          {value && (
            <button
              type="button"
              onClick={() => {
                onChange("");
                setOpen(false);
              }}
              className="text-ink-500 mt-2 text-xs hover:underline"
            >
              Clear
            </button>
          )}
        </div>
      )}
    </div>
  );
}

const monthOf = (day: string): [number, number] => [Number(day.slice(0, 4)), Number(day.slice(5, 7)) - 1];
const readable = (day: string) =>
  new Date(`${day}T00:00:00Z`).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" });
