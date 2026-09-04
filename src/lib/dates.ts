/**
 * Calendar-date arithmetic.
 *
 * A night is a *calendar date at the property* — no time, no time zone
 * (doc §2.1). Postgres stores these as `date`; Prisma hands them back as a
 * JavaScript `Date` at midnight UTC. Every helper here reads and writes the UTC
 * components, so a rep in Los Angeles and a rep in Zurich agree on which night
 * `10-Jul` is.
 */

export const DAY_MS = 86_400_000;

/** Strips any time component, keeping the UTC calendar day. */
export function toDay(date: Date): Date {
  return new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()),
  );
}

/** "2028-07-10" — the key a night is identified by. */
export function dayKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** Parses "2028-07-10", as typed into a date input, into that calendar day. */
export function parseDay(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`);
}

export function addDays(date: Date, days: number): Date {
  return new Date(toDay(date).getTime() + days * DAY_MS);
}

/**
 * Whole nights between check-in and check-out. Dates are closed-open
 * (invariant §4.5.7): `10-Jul → 31-Jul` is 21 nights, and check-out day is
 * never a night.
 */
export function nightsBetween(checkIn: Date, checkOut: Date): number {
  return Math.max(
    0,
    Math.round((toDay(checkOut).getTime() - toDay(checkIn).getTime()) / DAY_MS),
  );
}

/** Every night in `[checkIn, checkOut)`, in order. */
export function eachNight(checkIn: Date, checkOut: Date): Date[] {
  const out: Date[] = [];
  for (let i = 0; i < nightsBetween(checkIn, checkOut); i++) {
    out.push(addDays(checkIn, i));
  }
  return out;
}

/** Today as a calendar day, for deadline comparisons. */
export function today(): Date {
  return toDay(new Date());
}

/** Whole days from today to `date`; negative once the date is in the past. */
export function daysUntil(date: Date, from: Date = today()): number {
  return Math.round((toDay(date).getTime() - toDay(from).getTime()) / DAY_MS);
}
