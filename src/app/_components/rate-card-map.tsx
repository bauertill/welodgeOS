"use client";

import { AdvancedMarker, APIProvider, Map as GoogleMap, useMap, useMapsLibrary } from "@vis.gl/react-google-maps";
import { useEffect, useMemo, useState } from "react";

import { Combobox } from "~/app/_components/combobox";
import { formatDuration, formatKm } from "~/app/_components/travel-times";
import { env } from "~/env";
import { distanceKm } from "~/lib/scouting";
import { placeIcon } from "~/lib/place-icons";
import { api } from "~/trpc/react";

const mapId = env.NEXT_PUBLIC_GOOGLE_MAPS_MAP_ID ?? "DEMO_MAP_ID";

type Property = { id: string; name: string; latitude: number | null; longitude: number | null };
type Venue = { id: string; name: string; category: string; notes: string | null; layerName: string | null; color: string | null; latitude: number; longitude: number };

function Frame({ points }: { points: { lat: number; lng: number }[] }) {
  const map = useMap();
  useEffect(() => {
    if (!map || !points.length) return;
    if (points.length === 1) {
      map.setCenter(points[0]!);
      map.setZoom(14);
      return;
    }
    const lats = points.map((point) => point.lat);
    const lngs = points.map((point) => point.lng);
    map.fitBounds({ north: Math.max(...lats), south: Math.min(...lats), east: Math.max(...lngs), west: Math.min(...lngs) }, 50);
  }, [map, points]);
  return null;
}

function Transit({ on }: { on: boolean }) {
  const map = useMap();
  const maps = useMapsLibrary("maps");
  useEffect(() => {
    if (!map || !maps || !on) return;
    const layer = new maps.TransitLayer();
    layer.setMap(map);
    return () => layer.setMap(null);
  }, [map, maps, on]);
  return null;
}

/**
 * The client's map on a rate card (doc §4.11): the properties suggested,
 * numbered as on the card, the event's venues with their sports, and the
 * metro on request — and, for any property and venue, how far it is and how
 * long it takes on foot, by car and by public transport, with Google's
 * directions a click away.
 */
export function RateCardMap({ token, properties, venues }: { token: string; properties: (Property & { rateCardPropertyId: string })[]; venues: Venue[] }) {
  const located = properties.filter((property) => property.latitude !== null && property.longitude !== null);
  const [propertyId, setPropertyId] = useState(located[0]?.rateCardPropertyId ?? "");
  const [venueId, setVenueId] = useState("");
  const [metro, setMetro] = useState(false);
  const from = located.find((property) => property.rateCardPropertyId === propertyId) ?? null;
  const to = venues.find((venue) => venue.id === venueId) ?? null;
  const journey = api.rateCard.journey.useQuery({ token, rateCardPropertyId: propertyId, placeId: venueId }, { enabled: Boolean(from && to), staleTime: Infinity, retry: false });
  const nearest = useMemo(
    () =>
      from
        ? venues
            .map((venue) => ({ venue, km: distanceKm({ latitude: from.latitude!, longitude: from.longitude! }, venue) }))
            .sort((a, b) => a.km - b.km)
            .slice(0, 5)
        : [],
    [from, venues],
  );
  // The properties frame the map at first; a chosen journey frames the two ends.
  const points = useMemo(
    () =>
      from && to
        ? [
            { lat: from.latitude!, lng: from.longitude! },
            { lat: to.latitude, lng: to.longitude },
          ]
        : located.map((property) => ({ lat: property.latitude!, lng: property.longitude! })),
    [from, to, located],
  );
  const apiKey = env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;
  if (!apiKey || located.length === 0) return null;

  const directions = (mode: "walking" | "driving" | "transit") =>
    from && to
      ? `https://www.google.com/maps/dir/?api=1&origin=${from.latitude},${from.longitude}&destination=${to.latitude},${to.longitude}&travelmode=${mode}`
      : "#";

  return (
    <section className="mx-auto max-w-3xl rounded-2xl bg-white px-8 py-7 shadow-[0_1px_3px_rgba(0,0,0,0.06)] print:hidden">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-ink-900 text-lg font-semibold">On the map</h2>
        <label className="text-ink-700 flex items-center gap-2 text-[13px]">
          <input type="checkbox" checked={metro} onChange={(e) => setMetro(e.target.checked)} className="accent-brand-500 h-4 w-4" />
          Show the metro and public transport
        </label>
      </div>
      <div className="overflow-hidden rounded-xl border border-ink-200/70">
        <APIProvider apiKey={apiKey}>
          <GoogleMap mapId={mapId} defaultCenter={points[0] ?? { lat: 0, lng: 0 }} defaultZoom={12} gestureHandling="cooperative" clickableIcons={false} style={{ height: "26rem", width: "100%" }}>
            <Frame points={points} />
            <Transit on={metro} />
            {venues.map((venue) => (
              <AdvancedMarker key={venue.id} position={{ lat: venue.latitude, lng: venue.longitude }} title={venue.name} zIndex={venueId === venue.id ? 500 : 10} onClick={() => setVenueId(venue.id)}>
                <span className="group relative block translate-y-1/2">
                  <span
                    className={`flex h-7 w-7 items-center justify-center rounded-full border-2 border-white text-[14px] leading-none shadow-md ${venueId === venue.id ? "ring-brand-300 scale-110 ring-4" : ""}`}
                    style={{ background: venue.color ?? "#9b1c31" }}
                  >
                    {placeIcon(venue)}
                  </span>
                  <span className="bg-ink-900 pointer-events-none absolute bottom-full left-1/2 mb-1.5 hidden -translate-x-1/2 rounded-full px-2.5 py-1 text-[12px] font-medium whitespace-nowrap text-white shadow-lg group-hover:block">
                    {venue.name}
                  </span>
                </span>
              </AdvancedMarker>
            ))}
            {located.map((property) => (
              <AdvancedMarker
                key={property.rateCardPropertyId}
                position={{ lat: property.latitude!, lng: property.longitude! }}
                title={property.name}
                zIndex={1000}
                onClick={() => setPropertyId(property.rateCardPropertyId)}
              >
                <span className="group relative block translate-y-1/2">
                  <span
                    className={`bg-brand-500 flex h-8 w-8 items-center justify-center rounded-md border-2 border-white text-[13px] font-semibold text-white shadow-md ${propertyId === property.rateCardPropertyId ? "ring-brand-300 ring-4" : ""}`}
                  >
                    {properties.findIndex((one) => one.rateCardPropertyId === property.rateCardPropertyId) + 1}
                  </span>
                  <span className="bg-ink-900 pointer-events-none absolute bottom-full left-1/2 mb-1.5 hidden -translate-x-1/2 rounded-full px-2.5 py-1 text-[12px] font-medium whitespace-nowrap text-white shadow-lg group-hover:block">
                    {property.name}
                  </span>
                </span>
              </AdvancedMarker>
            ))}
          </GoogleMap>
        </APIProvider>
      </div>

      <div className="mt-5">
        <h3 className="text-ink-900 text-[15px] font-semibold">Getting there</h3>
        <div className="mt-2 grid gap-2 sm:grid-cols-2">
          <select
            value={propertyId}
            onChange={(e) => setPropertyId(e.target.value)}
            aria-label="From"
            className="border-ink-200 focus:border-brand-400 rounded-lg border bg-white px-3 py-2 text-sm font-light outline-none"
          >
            {located.map((property) => (
              <option key={property.rateCardPropertyId} value={property.rateCardPropertyId}>
                From {properties.findIndex((one) => one.rateCardPropertyId === property.rateCardPropertyId) + 1}. {property.name}
              </option>
            ))}
          </select>
          <Combobox
            value={venueId}
            onChange={setVenueId}
            placeholder="To a venue — type to search"
            options={venues.map((venue) => ({ id: venue.id, label: venue.name, detail: venue.notes?.split(/[\n.]/)[0]?.slice(0, 40) ?? null }))}
          />
        </div>

        {from && to ? (
          <div className="bg-brand-50/60 mt-3 rounded-xl px-4 py-3">
            <p className="text-ink-900 text-[13px] font-medium">
              {from.name} → {to.name} · {distanceKm({ latitude: from.latitude!, longitude: from.longitude! }, to).toFixed(1)} km as the crow flies
            </p>
            {journey.isLoading ? (
              <p className="text-ink-500 mt-2 text-xs font-light">Asking Google…</p>
            ) : journey.isError ? (
              <p className="text-ink-500 mt-2 text-xs font-light">Travel times are not available right now.</p>
            ) : (
              <dl className="mt-2 grid grid-cols-3 gap-3">
                {(
                  [
                    ["On foot", journey.data?.walk ?? null, "walking"],
                    ["By car", journey.data?.car ?? null, "driving"],
                    ["Public transport", journey.data?.transit ?? null, "transit"],
                  ] as const
                ).map(([label, leg, mode]) => (
                  <div key={label}>
                    <dt className="text-ink-500 text-[11px]">{label}</dt>
                    <dd className="text-ink-900 text-[15px] font-semibold">
                      {leg ? formatDuration(leg.seconds) : <span className="text-ink-500 text-xs font-light">not available</span>}
                      {leg && <span className="text-ink-500 block text-[11px] font-light">{formatKm(leg.metres)}</span>}
                      <a href={directions(mode)} target="_blank" rel="noreferrer" className="text-brand-700 text-[11px] font-light hover:underline">
                        Directions ↗
                      </a>
                    </dd>
                  </div>
                ))}
              </dl>
            )}
            <p className="text-ink-500 mt-2 text-[10px] font-light">Google&rsquo;s estimate for an ordinary weekday morning.</p>
          </div>
        ) : (
          nearest.length > 0 && (
            <div className="mt-3">
              <p className="text-ink-500 text-xs font-light">Nearest venues to {from?.name}:</p>
              <ul className="mt-1 flex flex-wrap gap-1.5">
                {nearest.map(({ venue, km }) => (
                  <li key={venue.id}>
                    <button type="button" onClick={() => setVenueId(venue.id)} className="border-ink-200 hover:border-brand-400 rounded-full border bg-white px-3 py-1 text-xs">
                      {placeIcon(venue)} {venue.name} · {km.toFixed(1)} km
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )
        )}
      </div>
    </section>
  );
}
