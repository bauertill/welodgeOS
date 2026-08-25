// Swiss locale — We Lodge AG is headquartered in Switzerland.
const dateFormat = new Intl.DateTimeFormat("en-CH", {
  day: "2-digit",
  month: "short",
  year: "numeric",
});

const shortDateFormat = new Intl.DateTimeFormat("en-CH", {
  day: "2-digit",
  month: "short",
});

export function formatDate(date: Date) {
  return dateFormat.format(date);
}

/** "14 Jun – 21 Jun 2026", collapsing the year when the stay stays in one. */
export function formatRange(from: Date, to: Date) {
  return from.getFullYear() === to.getFullYear()
    ? `${shortDateFormat.format(from)} – ${dateFormat.format(to)}`
    : `${dateFormat.format(from)} – ${dateFormat.format(to)}`;
}

export function nights(from: Date, to: Date) {
  return Math.max(
    0,
    Math.round((to.getTime() - from.getTime()) / 86_400_000),
  );
}

export function formatMoney(cents: number, currency: string) {
  return new Intl.NumberFormat("en-CH", {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  }).format(cents / 100);
}
