import { env } from "~/env";

/**
 * Finding places (doc §3.1, §4.11): Google Maps search through Places API
 * (New) on the server's key, and an address turned into coordinates through
 * OpenStreetMap. Used by the property form, and — through a client's needs
 * link only — by the client telling us where they want to be.
 */

/**
 * Suggestions as an address or a name is typed. `available` is false while
 * Google refuses — the API not switched on, or no key — and the box is then an
 * ordinary one to type or paste into.
 */
export async function searchPlaces(query: string, sessionToken: string) {
  const key = env.GOOGLE_MAPS_SERVER_KEY;
  if (!key) return { available: false, suggestions: [] };
  const response = await fetch("https://places.googleapis.com/v1/places:autocomplete", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": key,
      "X-Goog-FieldMask": "suggestions.placePrediction.placeId,suggestions.placePrediction.structuredFormat",
    },
    body: JSON.stringify({ input: query, sessionToken }),
  }).catch(() => null);
  // Refused outright means not switched on; anything else is a passing failure.
  const refused = response !== null && [400, 401, 403].includes(response.status);
  if (!response?.ok) return { available: !refused, suggestions: [] };
  const data = (await response.json()) as {
    suggestions?: { placePrediction?: { placeId: string; structuredFormat?: { mainText?: { text: string }; secondaryText?: { text: string } } } }[];
  };
  return {
    available: true,
    suggestions: (data.suggestions ?? [])
      .map((suggestion) => suggestion.placePrediction)
      .filter((prediction): prediction is NonNullable<typeof prediction> => Boolean(prediction))
      .map((prediction) => ({
        placeId: prediction.placeId,
        main: prediction.structuredFormat?.mainText?.text ?? "",
        secondary: prediction.structuredFormat?.secondaryText?.text ?? "",
      })),
  };
}

/** What Google Maps knows of the place picked: its address, city, country, coordinates, website and phone. */
export async function placeDetails(placeId: string, sessionToken: string) {
  const key = env.GOOGLE_MAPS_SERVER_KEY;
  if (!key) return null;
  const url = new URL(`https://places.googleapis.com/v1/places/${encodeURIComponent(placeId)}`);
  url.searchParams.set("sessionToken", sessionToken);
  const response = await fetch(url, {
    headers: {
      "X-Goog-Api-Key": key,
      "X-Goog-FieldMask": "displayName,formattedAddress,addressComponents,location,websiteUri,internationalPhoneNumber,types",
    },
  }).catch(() => null);
  if (!response?.ok) return null;
  const place = (await response.json()) as {
    displayName?: { text: string };
    formattedAddress?: string;
    addressComponents?: { longText: string; types: string[] }[];
    location?: { latitude: number; longitude: number };
    websiteUri?: string;
    internationalPhoneNumber?: string;
    types?: string[];
  };
  const part = (type: string) => place.addressComponents?.find((component) => component.types.includes(type))?.longText ?? null;
  return {
    name: place.displayName?.text ?? null,
    address: place.formattedAddress ?? null,
    city: part("locality") ?? part("postal_town") ?? part("administrative_area_level_2"),
    country: part("country"),
    latitude: place.location?.latitude ?? null,
    longitude: place.location?.longitude ?? null,
    website: place.websiteUri ?? null,
    phone: place.internationalPhoneNumber ?? null,
    /** Whether Google calls it somewhere to stay — then its name is the property's. */
    lodging: (place.types ?? []).includes("lodging"),
  };
}

/** An address in words → coordinates, through OpenStreetMap; null when it cannot be found. */
export async function geocode(parts: (string | null | undefined)[]) {
  const query = parts
    .map((part) => part?.trim())
    .filter(Boolean)
    .join(", ");
  if (!query) return null;
  const url = new URL("https://nominatim.openstreetmap.org/search");
  url.searchParams.set("q", query);
  url.searchParams.set("format", "jsonv2");
  url.searchParams.set("limit", "1");
  const response = await fetch(url, { headers: { "User-Agent": "WeLodgeOS (os@welodge.net)" } }).catch(() => null);
  if (!response?.ok) return null;
  const results = (await response.json()) as { lat: string; lon: string; display_name?: string }[];
  const first = results[0];
  return first ? { latitude: Number(first.lat), longitude: Number(first.lon), address: first.display_name ?? null } : null;
}
