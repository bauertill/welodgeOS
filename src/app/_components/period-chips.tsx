"use client";

import { formatDay } from "~/lib/format";
import { parseDay } from "~/lib/dates";
import type { EventPeriodDays } from "~/lib/event-periods";

/**
 * The event's periods as one-click dates (doc §3.10): choosing "Paralympics"
 * fills in a line's arrival and departure. Nothing shows for an event with
 * none. The dates can still be typed by hand afterwards.
 */
export function PeriodChips({
  periods,
  checkIn,
  checkOut,
  onPick,
}: {
  periods: EventPeriodDays[];
  checkIn: string;
  checkOut: string;
  onPick: (checkIn: string, checkOut: string) => void;
}) {
  if (periods.length === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-1.5 text-xs">
      {periods.map((period) => {
        const chosen = checkIn === period.from && checkOut === period.to;
        return (
          <button
            key={`${period.name}-${period.from}`}
            type="button"
            aria-pressed={chosen}
            onClick={() => onPick(period.from, period.to)}
            title={`${formatDay(parseDay(period.from))} – check-out ${formatDay(parseDay(period.to))}`}
            className={`rounded-full border px-2.5 py-0.5 transition-colors ${chosen ? "border-brand-400 bg-brand-50 text-brand-800 font-medium" : "border-ink-200 text-ink-500 hover:text-ink-900 bg-white font-light"}`}
          >
            {period.name}
          </button>
        );
      })}
    </div>
  );
}
