import type { PropertyType, ScoutingStatus } from "generated/prisma";

/**
 * The semantic vocabulary the app speaks. Every label a non-technical user
 * reads comes from here, so wording is changed in one place and stays
 * consistent with docs/product-scope.md.
 */

export const scoutingStatusLabels: Record<ScoutingStatus, string> = {
  PROSPECT: "Prospect",
  CONTACTED: "Contacted",
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

export const scoutingStatusOrder: ScoutingStatus[] = [
  "PROSPECT",
  "CONTACTED",
  "SHORTLISTED",
  "REJECTED",
  "CONTRACTED",
];

export const propertyTypeLabels: Record<PropertyType, string> = {
  HOTEL: "Hotel",
  APARTMENT: "Apartment",
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

type CategoryLike = {
  unitCount: number;
  indicativePriceCents: number | null;
  currency: string;
};

/** Total rooms/units across a property's categories. */
export function totalUnits(categories: CategoryLike[]): number {
  return categories.reduce((sum, category) => sum + category.unitCount, 0);
}

/** The cheapest indicative price, which is what "from CHF x" means on a row. */
export function cheapestCategory<T extends CategoryLike>(
  categories: T[],
): T | undefined {
  return categories
    .filter((category) => category.indicativePriceCents !== null)
    .sort(
      (a, b) => (a.indicativePriceCents ?? 0) - (b.indicativePriceCents ?? 0),
    )[0];
}
