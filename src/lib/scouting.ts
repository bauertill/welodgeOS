import type {
  CategoryContractStatus,
  PlaceCategory,
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
 * The places guests need to reach (doc §3.7). Venue first: it is the one every
 * event has, and the one the scouting list measures distance to.
 */
export const placeCategoryOrder: PlaceCategory[] = [
  "VENUE",
  "TRAIN_STATION",
  "AIRPORT",
  "IBC",
  "OTHER",
];

export const placeCategoryLabels: Record<PlaceCategory, string> = {
  VENUE: "Venue",
  TRAIN_STATION: "Train station",
  AIRPORT: "Airport",
  IBC: "IBC",
  OTHER: "Other",
};

/** Plural forms, for the headings a list of them sits under. */
export const placeCategoryPlurals: Record<PlaceCategory, string> = {
  VENUE: "Venues",
  TRAIN_STATION: "Train stations",
  AIRPORT: "Airports",
  IBC: "IBC",
  OTHER: "Other places",
};

/** What each one is for, so nobody has to guess what belongs where. */
export const placeCategoryHints: Record<PlaceCategory, string> = {
  VENUE: "Where the event happens. Distance to the nearest one is on the scouting list.",
  TRAIN_STATION: "Record the lines serving it — a client asks which ones.",
  AIRPORT: "Where guests fly in.",
  IBC: "The International Broadcast Centre, where the broadcasters work.",
  OTHER: "Anything else guests need to get to.",
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

type Located = { latitude: number; longitude: number };

/**
 * The venue a property is closest to, and how far. An event can have several
 * (doc §3.7), so "distance to venue" has to say *which* venue, or the number
 * means nothing.
 */
export function nearestPlace<T extends Located & { name: string }>(
  from: Located | null,
  places: T[],
): { place: T; km: number } | null {
  if (!from || places.length === 0) return null;

  return places
    .map((place) => ({ place, km: distanceKm(from, place) }))
    .sort((a, b) => a.km - b.km)[0]!;
}

type CategoryLike = {
  unitCount: number;
  indicativePriceCents: number | null;
  currency: string;
};

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
