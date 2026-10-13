import { env } from "~/env";

/**
 * Metro and light-rail stations around an event's places (doc §3.7), from
 * Google Maps (Places API) — so their names match what Google shows. Google
 * answers at most 20 places a search, so each place is searched around in
 * turn, 2.5 km out, and the answers merged. The lines themselves are Google's
 * own, drawn by its Public transport layer.
 */
export type MetroStation = { googleId: string; name: string; latitude: number; longitude: number; address: string | null };

type GooglePlace = { id: string; displayName?: { text?: string }; location?: { latitude: number; longitude: number }; formattedAddress?: string };

export async function fetchStations(around: { latitude: number; longitude: number }[]): Promise<MetroStation[] | null> {
  const key = env.GOOGLE_MAPS_SERVER_KEY;
  if (!key) return null;
  const found = new Map<string, MetroStation>();
  let answered = 0;
  // A few at a time, not all at once.
  for (let start = 0; start < around.length; start += 5) {
    const batch = around.slice(start, start + 5);
    await Promise.all(
      batch.map(async (point) => {
        const response = await fetch("https://places.googleapis.com/v1/places:searchNearby", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Goog-Api-Key": key,
            "X-Goog-FieldMask": "places.id,places.displayName,places.location,places.formattedAddress",
          },
          body: JSON.stringify({
            includedTypes: ["subway_station", "light_rail_station"],
            maxResultCount: 20,
            locationRestriction: { circle: { center: { latitude: point.latitude, longitude: point.longitude }, radius: 2500 } },
          }),
          signal: AbortSignal.timeout(15_000),
        }).catch(() => null);
        if (!response?.ok) return;
        answered += 1;
        const data = (await response.json().catch(() => ({}))) as { places?: GooglePlace[] };
        for (const place of data.places ?? []) {
          if (!place.location || !place.displayName?.text) continue;
          found.set(place.id, {
            googleId: place.id,
            name: place.displayName.text,
            latitude: place.location.latitude,
            longitude: place.location.longitude,
            address: place.formattedAddress ?? null,
          });
        }
      }),
    );
  }
  return answered ? [...found.values()] : null;
}
