import { formatDay } from "~/lib/format";

/**
 * An event's named periods (doc §3.10) — LA28's Olympics, Between Games and
 * Paralympics, each with its own rates. Like a stay: `from` is the first
 * night, `to` the check-out day. Most events have none; their own dates are
 * then the one period, and nothing here is shown.
 */
export type EventPeriodDays = { name: string; from: string; to: string };

/** A colour per period, in date order — on the stock sheet and its chips. */
const palette = ["#7c4dd8", "#1d8fa8", "#d9822b", "#2f9e5b", "#d63c7a", "#3b6fd4"];
export const periodColour = (index: number) => palette[index % palette.length]!;

export const byStart = <T extends { from: string }>(periods: T[]) => [...periods].sort((a, b) => a.from.localeCompare(b.from));

/** What is wrong with a set of periods, if anything: names, dates, and no overlaps — gaps are fine. */
export function eventPeriodProblem(periods: EventPeriodDays[]): string | null {
  for (const [index, period] of periods.entries()) {
    const label = period.name.trim() || `Period ${index + 1}`;
    if (!period.name.trim()) return `Period ${index + 1} needs a name, like Olympics.`;
    if (!period.from || !period.to) return `${label} needs its first night and its check-out day.`;
    if (period.to <= period.from) return `${label}: the check-out day must be after the first night.`;
  }
  const names = periods.map((period) => period.name.trim().toLowerCase());
  const twice = names.find((name, index) => names.indexOf(name) !== index);
  if (twice) return `Two periods are called ${periods[names.indexOf(twice)]!.name.trim()} — give each its own name.`;
  const sorted = byStart(periods);
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i]!.from < sorted[i - 1]!.to) {
      return `${sorted[i - 1]!.name.trim()} and ${sorted[i]!.name.trim()} overlap around ${formatDay(new Date(`${sorted[i]!.from}T00:00:00Z`))}.`;
    }
  }
  return null;
}

/** The period a night falls in, if any. */
export function periodOfNight<T extends { from: string; to: string }>(periods: T[], night: string): T | undefined {
  return periods.find((period) => night >= period.from && night < period.to);
}

/**
 * A stay cut where the event's periods begin and end (doc §4.8): one piece per
 * period it touches, and one for any nights outside them — before, between or
 * after — so the pieces run from check-in to check-out with nothing missed.
 */
export function splitStayByPeriods(checkIn: string, checkOut: string, periods: EventPeriodDays[]): { checkIn: string; checkOut: string; label: string }[] {
  if (!checkIn || !checkOut || checkOut <= checkIn) return [];
  const sorted = byStart(periods);
  const cuts = new Set<string>([checkIn, checkOut]);
  for (const period of sorted) {
    if (period.from > checkIn && period.from < checkOut) cuts.add(period.from);
    if (period.to > checkIn && period.to < checkOut) cuts.add(period.to);
  }
  const days = [...cuts].sort();
  const pieces = days.slice(0, -1).map((from, index) => ({ checkIn: from, checkOut: days[index + 1]! }));
  return pieces.map((piece) => {
    const inside = periodOfNight(sorted, piece.checkIn);
    if (inside) return { ...piece, label: inside.name };
    const before = sorted.filter((period) => period.to <= piece.checkIn).at(-1);
    const after = sorted.find((period) => period.from >= piece.checkOut);
    const label = before && after ? `Between ${before.name} and ${after.name}` : after ? `Before ${after.name}` : before ? `After ${before.name}` : "Outside the periods";
    return { ...piece, label };
  });
}
