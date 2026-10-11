import type { PropertyType } from "generated/prisma";

import { env } from "~/env";
import { distanceKm } from "~/lib/scouting";
import { looksLike } from "~/lib/similar-properties";

/**
 * Finding places to stay that we do not have yet (doc §4.11), around one of
 * a client's places: through Google Maps (Places API, New) on the server's
 * key, or — while Google refuses, the API not switched on for the key —
 * through OpenStreetMap, whose map of hotels is free but patchier. Each answer
 * is kept for a few hours, so opening a task again does not search again; a
 * search that failed (OpenStreetMap's free server is often busy) is not kept.
 */

export type Found = {
  /** "google:<place id>" or "osm:<type>/<id>". */
  key: string;
  name: string;
  type: PropertyType;
  latitude: number;
  longitude: number;
  address: string | null;
  city: string | null;
  country: string | null;
  website: string | null;
  phone: string | null;
  /** Google's guest rating, 1–5, and how many gave one. */
  rating: number | null;
  ratingCount: number | null;
  /** Google's price level, as $ to $$$$. */
  priceLevel: string | null;
  stars: number | null;
  /** Rooms, when the map says (OpenStreetMap sometimes does). */
  rooms: number | null;
  /** Where to see it on the map. */
  mapUrl: string;
};
export type Source = "google" | "osm";
type Point = { latitude: number; longitude: number };

const HOURS = 6;
const cache = new Map<string, { at: number; value: { source: Source; found: Found[] } }>();

/** Places to stay within `radiusKm` of a point: hotels, and apartments when asked for; null when no map answered. */
export async function findNearby(point: Point, radiusKm: number, kinds: { hotels: boolean; apartments: boolean }) {
  const key = `${point.latitude.toFixed(4)},${point.longitude.toFixed(4)},${radiusKm},${kinds.hotels},${kinds.apartments}`;
  const kept = cache.get(key);
  // Google's answers are kept for hours; a fallback to OpenStreetMap only briefly, so Google is asked again soon.
  const keepFor = kept?.value.source === "google" ? HOURS * 3600_000 : 15 * 60_000;
  if (kept && Date.now() - kept.at < keepFor) return kept.value;
  const google = await fromGoogle(point, radiusKm, kinds);
  let value: { source: Source; found: Found[] } | null = google ? { source: "google", found: google } : null;
  if (!value) {
    // OpenStreetMap's server turns requests away when busy: one more try, a moment later.
    const osm = (await fromOpenStreetMap(point, radiusKm, kinds)) ?? (await new Promise((resolve) => setTimeout(resolve, 2000)).then(() => fromOpenStreetMap(point, radiusKm, kinds)));
    if (osm) value = { source: "osm", found: osm };
  }
  if (value) cache.set(key, { at: Date.now(), value });
  return value;
}

// --- Google Maps -------------------------------------------------------------

const priceLevels: Record<string, string> = {
  PRICE_LEVEL_INEXPENSIVE: "$",
  PRICE_LEVEL_MODERATE: "$$",
  PRICE_LEVEL_EXPENSIVE: "$$$",
  PRICE_LEVEL_VERY_EXPENSIVE: "$$$$",
};

type GooglePlace = {
  id: string;
  displayName?: { text: string };
  formattedAddress?: string;
  addressComponents?: { longText: string; types: string[] }[];
  location?: { latitude: number; longitude: number };
  types?: string[];
  primaryType?: string;
  rating?: number;
  userRatingCount?: number;
  priceLevel?: string;
  websiteUri?: string;
  internationalPhoneNumber?: string;
  googleMapsUri?: string;
};

/** Booking and holiday-let sites: a place whose website is one of these is a listing, not a hotel's own. */
const listingSite = /(^|\.)(airbnb|booking|vrbo|expedia|bluepillow|hotels|tripadvisor|agoda|trivago|homeaway|furnishedfinder|zillow|apartments|corporatehousing|blueground|kayak)\.[a-z.]+$/i;

const hostOf = (url: string) => {
  try {
    return new URL(url).hostname;
  } catch {
    return "";
  }
};

/** null when Google refuses or fails — the caller then asks OpenStreetMap. */
async function fromGoogle(point: Point, radiusKm: number, kinds: { hotels: boolean; apartments: boolean }) {
  const key = env.GOOGLE_MAPS_SERVER_KEY;
  if (!key) return null;
  const queries = [...(kinds.hotels ? ["hotels"] : []), ...(kinds.apartments ? ["serviced apartments", "aparthotel"] : [])];
  const found = new Map<string, Found>();
  let answered = 0;
  for (const textQuery of queries) {
    const response = await fetch("https://places.googleapis.com/v1/places:searchText", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": key,
        "X-Goog-FieldMask": [
          "places.id",
          "places.displayName",
          "places.formattedAddress",
          "places.addressComponents",
          "places.location",
          "places.types",
          "places.primaryType",
          "places.rating",
          "places.userRatingCount",
          "places.priceLevel",
          "places.websiteUri",
          "places.internationalPhoneNumber",
          "places.googleMapsUri",
        ].join(","),
      },
      body: JSON.stringify({
        textQuery,
        includedType: "lodging",
        pageSize: 20,
        // Only the coordinates — Google refuses a place sent with anything else (its name, a label).
        locationBias: { circle: { center: { latitude: point.latitude, longitude: point.longitude }, radius: Math.min(50_000, radiusKm * 1000) } },
      }),
      signal: AbortSignal.timeout(10_000),
    }).catch(() => null);
    // One search failing does not lose the others' answers.
    if (!response?.ok) continue;
    answered += 1;
    const data = (await response.json().catch(() => ({}))) as { places?: GooglePlace[] };
    for (const place of data.places ?? []) {
      if (!place.location || !place.displayName?.text) continue;
      const types = place.types ?? [];
      // Campsites, hostels and the like are not for our clients.
      if (types.some((type) => ["campground", "rv_park", "hostel", "camping_cabin"].includes(type))) continue;
      // A holiday let listed through a booking site is somebody's flat, not a place we contract.
      if (place.websiteUri && listingSite.test(hostOf(place.websiteUri))) continue;
      const part = (type: string) => place.addressComponents?.find((component) => component.types.includes(type))?.longText ?? null;
      const apartment = textQuery !== "hotels" || types.includes("extended_stay_hotel");
      found.set(place.id, {
        key: `google:${place.id}`,
        name: place.displayName.text,
        type: apartment ? "APARTHOTEL" : "HOTEL",
        latitude: place.location.latitude,
        longitude: place.location.longitude,
        address: place.formattedAddress ?? null,
        city: part("locality") ?? part("postal_town") ?? part("administrative_area_level_2"),
        country: part("country"),
        website: place.websiteUri ? cleanWebsite(place.websiteUri) : null,
        phone: place.internationalPhoneNumber ?? null,
        rating: place.rating ?? null,
        ratingCount: place.userRatingCount ?? null,
        priceLevel: place.priceLevel ? (priceLevels[place.priceLevel] ?? null) : null,
        stars: null,
        rooms: null,
        mapUrl: place.googleMapsUri ?? `https://www.google.com/maps/place/?q=place_id:${place.id}`,
      });
    }
  }
  return answered ? [...found.values()] : null;
}

// --- OpenStreetMap -----------------------------------------------------------

type OsmElement = { type: string; id: number; lat?: number; lon?: number; center?: { lat: number; lon: number }; tags?: Record<string, string> };

async function fromOpenStreetMap(point: Point, radiusKm: number, kinds: { hotels: boolean; apartments: boolean }) {
  const tourism = [...(kinds.hotels ? ["hotel", "motel"] : []), ...(kinds.apartments ? ["apartment"] : [])];
  if (tourism.length === 0) return [];
  const around = `around:${Math.round(radiusKm * 1000)},${point.latitude},${point.longitude}`;
  const query = `[out:json][timeout:25];nwr["tourism"~"^(${tourism.join("|")})$"]["name"](${around});out center tags 150;`;
  const response = await fetch("https://overpass-api.de/api/interpreter", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", "User-Agent": "WeLodgeOS (os@welodge.net)" },
    body: new URLSearchParams({ data: query }),
  }).catch(() => null);
  if (!response?.ok) return null;
  // A busy server can answer 200 with an error page, or JSON carrying a "remark" instead of results.
  const data = (await response.json().catch(() => null)) as { elements?: OsmElement[]; remark?: string } | null;
  if (!data?.elements || (data.remark && /error|timeout|busy/i.test(data.remark))) return null;
  const found: Found[] = [];
  for (const element of data.elements) {
    const tags = element.tags ?? {};
    const latitude = element.lat ?? element.center?.lat;
    const longitude = element.lon ?? element.center?.lon;
    if (latitude === undefined || longitude === undefined || !tags.name) continue;
    const apartment = tags.tourism === "apartment";
    // A flat with no website is someone's home let out, not a place we can contract.
    if (apartment && !(tags.website ?? tags["contact:website"])) continue;
    const street = [tags["addr:housenumber"], tags["addr:street"]].filter(Boolean).join(" ");
    const stars = Number.parseInt(tags.stars ?? "", 10);
    const rooms = Number.parseInt(tags.rooms ?? "", 10);
    found.push({
      key: `osm:${element.type}/${element.id}`,
      name: tags.name,
      type: apartment ? "APARTMENT" : "HOTEL",
      latitude,
      longitude,
      address: [street, tags["addr:city"]].filter(Boolean).join(", ") || null,
      city: tags["addr:city"] ?? null,
      country: tags["addr:country"] ?? null,
      website: tags.website ?? tags["contact:website"] ?? null,
      phone: tags.phone ?? tags["contact:phone"] ?? null,
      rating: null,
      ratingCount: null,
      priceLevel: null,
      stars: stars >= 1 && stars <= 5 ? stars : null,
      rooms: rooms > 0 ? rooms : null,
      mapUrl: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${tags.name} ${latitude},${longitude}`)}`,
    });
  }
  return found;
}

/** The nearest of several points, and how far. */
export function nearest<T extends Point & { label: string }>(from: Point, targets: T[]) {
  return targets.map((target) => ({ target, km: distanceKm(from, target) })).sort((a, b) => a.km - b.km)[0] ?? null;
}

/** A website as Google gives it, without its tracking tags (?utm_source=google…). */
export function cleanWebsite(url: string) {
  try {
    const parsed = new URL(url);
    for (const key of [...parsed.searchParams.keys()]) if (/^utm_|^gclid$|^fbclid$/i.test(key)) parsed.searchParams.delete(key);
    return parsed.toString();
  } catch {
    return url;
  }
}

/** Whether a found place is one we already have: the same name or address, or the very same spot (doc §4.11). */
export function knownAlready(
  place: { name: string; address: string | null; latitude: number; longitude: number },
  ours: { id: string; name: string; address: string | null; latitude: number | null; longitude: number | null }[],
) {
  return ours.some((property) => {
    if (looksLike({ name: place.name, address: place.address }, { ...property, latitude: null, longitude: null })) return true;
    return property.latitude !== null && property.longitude !== null && distanceKm(place, { latitude: property.latitude, longitude: property.longitude }) < 0.04;
  });
}
