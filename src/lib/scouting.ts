import type {
  CategoryContractStatus,
  PropertyType,
  ScoutingStatus,
} from "generated/prisma";

/**
 * The semantic vocabulary the app speaks. Every label a non-technical user
 * reads comes from here, so wording is changed in one place and stays
 * consistent with docs/product-scope.md.
 */

export const scoutingStatusLabels: Record<ScoutingStatus, string> = {
  PROSPECT: "Prospect",
  CONTACTED: "Reached out",
  SHORTLISTED: "Shortlisted",
  REJECTED: "Rejected",
  CONTRACTED: "Contracted",
};

/** What each status actually means, shown as help text rather than assumed. */
export const scoutingStatusHints: Record<ScoutingStatus, string> = {
  PROSPECT: "On the long list. Nobody has spoken to them yet.",
  CONTACTED: "We have reached out and are waiting to hear back.",
  SHORTLISTED: "A serious candidate — worth taking to a client.",
  REJECTED: "Ruled out for this event. Kept so we do not re-scout it.",
  CONTRACTED: "Moved through to acquisition. Phase 2 owns it from here.",
};

/**
 * `CONTRACTED` is deliberately excluded — a property has no single contract
 * status of its own any more, that fact lives per room category on
 * `CategoryContract` (doc §3.5, §3.6). The label and hint above stay defined
 * for `CONTRACTED` regardless, so any historical row still reads correctly
 * wherever it is displayed.
 */
export type SelectableScoutingStatus = Exclude<ScoutingStatus, "CONTRACTED">;

/** Selectable from the UI, in funnel order. */
export const scoutingStatusOrder: SelectableScoutingStatus[] = [
  "PROSPECT",
  "CONTACTED",
  "SHORTLISTED",
  "REJECTED",
];

export const categoryContractStatusLabels: Record<CategoryContractStatus, string> = {
  IN_NEGOTIATION: "In negotiation",
  IN_CONTRACTING: "In contracting",
  CONTRACTED: "Contracted",
};

export const categoryContractStatusHints: Record<CategoryContractStatus, string> = {
  IN_NEGOTIATION: "Talking terms with the supplier. Not yet in Inventory.",
  IN_CONTRACTING: "Terms agreed, paperwork in progress. Not yet in Inventory.",
  CONTRACTED: "Signed. This is what becomes Inventory.",
};

export const categoryContractStatusOrder: CategoryContractStatus[] = [
  "IN_NEGOTIATION",
  "IN_CONTRACTING",
  "CONTRACTED",
];

export const propertyTypeLabels: Record<PropertyType, string> = {
  HOTEL: "Hotel",
  APARTMENT: "Apartment",
  APARTHOTEL: "Aparthotel",
};

/**
 * A property is the same property regardless of case or stray whitespace —
 * "Hotel Carmel", "hotel carmel" and " Hotel Carmel " all name one place.
 * Used to catch a duplicate before it is ever saved (doc §3.1).
 */
export function normalizePropertyName(name: string) {
  return name.trim().toLowerCase();
}

/**
 * Great-circle distance in kilometres. Used for distance-to-venue, which is
 * derived from coordinates rather than stored (doc §3.1).
 */
export function distanceKm(
  from: { latitude: number; longitude: number },
  to: { latitude: number; longitude: number },
): number {
  const R = 6371;
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(to.latitude - from.latitude);
  const dLon = toRad(to.longitude - from.longitude);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(from.latitude)) *
      Math.cos(toRad(to.latitude)) *
      Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

/** Total rooms/units across a property's categories. */
export function totalUnits(categories: { unitCount: number }[]): number {
  return categories.reduce((sum, category) => sum + category.unitCount, 0);
}

type PricedCategory = {
  indicativePriceMinCents: number | null;
  indicativePriceMaxCents: number | null;
  currency: string;
};

/**
 * The category with the lowest indicative starting price, which is what
 * "from USD x" means on a row — the low end of its range, since the range
 * itself is indicative only (doc §3.2, §3.3).
 */
export function cheapestCategory<T extends PricedCategory>(
  categories: T[],
): T | undefined {
  return categories
    .filter((category) => category.indicativePriceMinCents !== null)
    .sort(
      (a, b) =>
        (a.indicativePriceMinCents ?? 0) - (b.indicativePriceMinCents ?? 0),
    )[0];
}
