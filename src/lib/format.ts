// Swiss locale — We Lodge AG is headquartered in Switzerland.
//
// Every date in this system is a calendar day at the property, stored as
// midnight UTC (doc §2.1, and see ~/lib/dates). Formatting it in the reader's
// own time zone would show 09-Jul to a reader in Los Angeles for a night that
// begins on the 10th, so the formatters are pinned to UTC.
const dateFormat = new Intl.DateTimeFormat("en-CH", {
  day: "2-digit",
  month: "short",
  year: "numeric",
  timeZone: "UTC",
});

const shortDateFormat = new Intl.DateTimeFormat("en-CH", {
  day: "2-digit",
  month: "short",
  timeZone: "UTC",
});

export function formatDate(date: Date) {
  return dateFormat.format(date);
}

/** "10 Jul" — for a column heading or a run of nights in the same year. */
export function formatDay(date: Date) {
  return shortDateFormat.format(date);
}

/** "14 Jun – 21 Jun 2026", collapsing the year when the stay stays in one. */
export function formatRange(from: Date, to: Date) {
  return from.getUTCFullYear() === to.getUTCFullYear()
    ? `${shortDateFormat.format(from)} – ${dateFormat.format(to)}`
    : `${dateFormat.format(from)} – ${dateFormat.format(to)}`;
}

export function formatMoney(cents: number, currency: string) {
  return new Intl.NumberFormat("en-CH", {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(cents / 100);
}

/**
 * "USD 220.00 – 280.00", or a single figure when only one end of the range is
 * known — an indicative price is often given as one bound before the other is
 * (doc §3.2, §3.3).
 */
export function formatMoneyRange(
  minCents: number | null,
  maxCents: number | null,
  currency: string,
): string {
  if (minCents === null && maxCents === null) return "—";
  if (minCents === null) return formatMoney(maxCents!, currency);
  if (maxCents === null) return formatMoney(minCents, currency);
  if (minCents === maxCents) return formatMoney(minCents, currency);
  return `${formatMoney(minCents, currency)} – ${formatMoney(maxCents, currency)}`;
}

/** "21 nights", "1 night" — used everywhere a night count is shown. */
export function formatNights(count: number) {
  return `${count} ${count === 1 ? "night" : "nights"}`;
}

/** "30 rooms", "1 room". */
export function formatRooms(count: number) {
  return `${count} ${count === 1 ? "room" : "rooms"}`;
}
