"use client";

import { AdvancedMarker, APIProvider, Map as GoogleMap, useMap } from "@vis.gl/react-google-maps";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import { env } from "~/env";
import { propertyTypeLabels } from "~/lib/scouting";
import { NEAR_KM, WITHIN_KM } from "~/lib/sourcing-fit";
import { api, type RouterOutputs } from "~/trpc/react";

const mapId = env.NEXT_PUBLIC_GOOGLE_MAPS_MAP_ID ?? "DEMO_MAP_ID";
const verdictStyles = {
  good: { dot: "bg-[#0a7a47]", badge: "bg-[#e3f8ee] text-[#0a7a47]", label: "Fits" },
  unclear: { dot: "bg-[#1d5fa8]", badge: "bg-[#e6f0fb] text-[#1d5fa8]", label: "Not enough known" },
  partly: { dot: "bg-[#e5a400]", badge: "bg-[#fff4e0] text-[#8a5a00]", label: "Fits in part" },
  poor: { dot: "bg-[#9a9a9a]", badge: "bg-ink-50 text-ink-500", label: "Does not fit" },
} as const;
type Verdict = keyof typeof verdictStyles;
// Only those that fit, entirely or in part, are offered; the rest are left out.
const verdictOrder: Verdict[] = ["good", "partly"];

/** Frames the map around every pin once they are known. */
function FitAll({ points }: { points: { latitude: number; longitude: number }[] }) {
  const map = useMap();
  const key = points.map((p) => `${p.latitude},${p.longitude}`).join("|");
  useEffect(() => {
    if (!map || points.length === 0) return;
    if (points.length === 1) {
      map.setCenter({ lat: points[0]!.latitude, lng: points[0]!.longitude });
      map.setZoom(14);
      return;
    }
    const lats = points.map((p) => p.latitude);
    const lngs = points.map((p) => p.longitude);
    map.fitBounds({ north: Math.max(...lats), south: Math.min(...lats), east: Math.max(...lngs), west: Math.min(...lngs) }, 48);
  }, [map, key]); // eslint-disable-line react-hooks/exhaustive-deps -- refit when the pins change
  return null;
}

/**
 * Sourcing a sales request (doc §4.11), on its task: where the client wants
 * to be, on a map, and the properties we already have around it — each judged
 * against the request, to open or add to the event.
 */
export function SourcingPanel({ salesRequestId }: { salesRequestId: string }) {
  const utils = api.useUtils();
  const data = api.sales.sourcing.useQuery({ id: salesRequestId });
  const add = api.scouting.add.useMutation({ onSuccess: () => void utils.sales.sourcing.invalidate() });
  const [focus, setFocus] = useState<string | null>(null);
  // Only the ones that fit entirely are shown at first; the rest wait behind their tabs.
  const [tab, setTab] = useState<Verdict>("good");
  // Not in the system: searched on the map once per visit, kept for an hour.
  const [radiusKm, setRadiusKm] = useState(5);
  const discover = api.sales.sourcingDiscover.useQuery({ id: salesRequestId, radiusKm }, { staleTime: 3600_000, refetchOnWindowFocus: false });
  const found = discover.data?.found ?? [];
  const addFound = useAddFound(salesRequestId, discover.data?.source ?? null);
  // The map's hover card: open while the pointer is on a dot or on its card.
  const [hovered, setHovered] = useState<string | null>(null);
  const leaving = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hover = (key: string | null) => {
    if (leaving.current) clearTimeout(leaving.current);
    if (key) setHovered(key);
    else leaving.current = setTimeout(() => setHovered(null), 200);
  };
  const apiKey = env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;

  if (data.isLoading) return <p className="text-ink-500 text-sm font-light">Loading the map…</p>;
  if (!data.data) return null;
  const { targets, fromEventPlaces, eventId, eventName } = data.data;
  const suggestions = data.data.suggestions.filter((property) => verdictOrder.includes(property.verdict));
  const shown = suggestions.filter((property) => property.verdict === tab);
  const counts = Object.fromEntries(verdictOrder.map((verdict) => [verdict, suggestions.filter((property) => property.verdict === verdict).length])) as Record<Verdict, number>;
  const points = [...targets, ...shown.slice(0, 15)];
  const center = points.length
    ? { lat: points.reduce((sum, p) => sum + p.latitude, 0) / points.length, lng: points.reduce((sum, p) => sum + p.longitude, 0) / points.length }
    : { lat: 34.05, lng: -118.25 };

  return (
    <div className="space-y-4">
      {targets.length === 0 ? (
        <p className="text-ink-500 text-sm font-light">The client has not said where they want to be, and the event has no places of interest yet.</p>
      ) : (
        <p className="text-ink-500 text-xs font-light">
          {fromEventPlaces ? "The client chose no places, so these are the event's own. " : "Where the client wants to be close to. "}
          The properties we already have around them that fit the request are shown, and those that fit in part behind their tab. Hollow purple dots are places to stay we do not have yet.
        </p>
      )}
      {apiKey && points.length > 0 && (
        <div className="border-ink-200/60 h-80 overflow-hidden rounded-lg border">
          <APIProvider apiKey={apiKey}>
            <GoogleMap mapId={mapId} defaultCenter={center} defaultZoom={12} gestureHandling="greedy" disableDefaultUI zoomControl>
              <FitAll points={points} />
              {targets.map((target) => (
                <AdvancedMarker key={`t-${target.label}`} position={{ lat: target.latitude, lng: target.longitude }} title={target.label} zIndex={50}>
                  <span className="bg-ink-900 rounded-full px-2.5 py-1 text-[12px] font-medium text-white shadow-lg">★ {target.label}</span>
                </AdvancedMarker>
              ))}
              {shown.map((property) => (
                <AdvancedMarker
                  key={property.id}
                  position={{ lat: property.latitude, lng: property.longitude }}
                  title={property.name}
                  zIndex={hovered === property.id ? 100 : focus === property.id ? 60 : 10}
                  onClick={() => {
                    setFocus(property.id);
                    document.getElementById(`suggestion-${property.id}`)?.scrollIntoView({ block: "nearest", behavior: "smooth" });
                  }}
                >
                  <span className="relative block" onMouseEnter={() => hover(property.id)} onMouseLeave={() => hover(null)}>
                    <span
                      className={`block rounded-full border-2 border-white shadow ${verdictStyles[property.verdict].dot} ${focus === property.id || hovered === property.id ? "h-5 w-5" : "h-3.5 w-3.5"}`}
                    />
                    {hovered === property.id && (
                      <MapCard>
                        <span className={`mb-1 inline-block rounded-full px-2 py-0.5 text-[11px] font-medium ${verdictStyles[property.verdict].badge}`}>
                          {verdictStyles[property.verdict].label}
                        </span>
                        <span className="text-ink-900 block text-[13px] font-medium">{property.name}</span>
                        <span className="text-ink-500 block text-xs font-light">
                          {propertyTypeLabels[property.type]}
                          {property.stars ? ` · ${property.stars}★` : ""}
                          {property.km !== null ? ` · ${property.checks[0]?.text ?? ""}` : ""}
                        </span>
                        <span className="mt-2 flex items-center gap-3 text-xs">
                          <Link href={`/properties/${property.id}${eventId ? `?back=${encodeURIComponent(`/events/${eventId}`)}` : ""}`} className="text-brand-700 hover:underline">
                            Open
                          </Link>
                          {eventId &&
                            (property.onEvent ? (
                              <span className="text-ink-500">On {eventName}</span>
                            ) : (
                              <button
                                type="button"
                                disabled={add.isPending}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  add.mutate({ eventId, propertyId: property.id });
                                }}
                                className="bg-brand-400 hover:bg-brand-500 rounded-full px-3 py-1 font-medium text-white"
                              >
                                Add to {eventName}
                              </button>
                            ))}
                        </span>
                      </MapCard>
                    )}
                  </span>
                </AdvancedMarker>
              ))}
              {found.map((place) => (
                <AdvancedMarker
                  key={place.key}
                  position={{ lat: place.latitude, lng: place.longitude }}
                  title={`${place.name} — not in the system`}
                  zIndex={hovered === place.key ? 100 : focus === place.key ? 60 : 5}
                  onClick={() => {
                    setFocus(place.key);
                    document.getElementById(`found-${place.key}`)?.scrollIntoView({ block: "nearest", behavior: "smooth" });
                  }}
                >
                  <span className="relative block" onMouseEnter={() => hover(place.key)} onMouseLeave={() => hover(null)}>
                    <span
                      className={`border-brand-500 block rounded-full border-2 bg-white shadow ${focus === place.key || hovered === place.key ? "h-4 w-4" : "h-2.5 w-2.5"}`}
                    />
                    {hovered === place.key && (
                      <MapCard>
                        <span className="text-brand-700 mb-0.5 block text-[10px] font-medium tracking-wider uppercase">Not in the system</span>
                        <span className="text-ink-900 block text-[13px] font-medium">{place.name}</span>
                        <span className="text-ink-500 block text-xs font-light">
                          {propertyTypeLabels[place.type]}
                          {place.stars ? ` · ${place.stars}★` : ""}
                          {place.rating ? ` · ${place.rating.toFixed(1)} rating` : ""}
                          {place.priceLevel ? ` · ${place.priceLevel}` : ""}
                          {place.checks[0] ? ` · ${place.checks[0].text}` : ""}
                        </span>
                        <span className="mt-2 flex flex-wrap items-center gap-3 text-xs">
                          <FoundActions place={place} eventName={eventName} adder={addFound} />
                        </span>
                      </MapCard>
                    )}
                  </span>
                </AdvancedMarker>
              ))}
            </GoogleMap>
          </APIProvider>
        </div>
      )}

      <div>
        <h3 className="text-ink-900 mb-2 text-[14px] font-medium">Properties we already have nearby</h3>
        {suggestions.length === 0 ? (
          <p className="text-ink-500 text-sm font-light">
            None that fits within {WITHIN_KM * 2} km yet — see the places not in the system below, or scout new ones on {eventName ? `${eventName}'s` : "the event's"} Properties tab.
          </p>
        ) : (
          <>
          <div className="mb-3 flex flex-wrap gap-1.5">
            {verdictOrder.map((verdict) => (
              <button
                key={verdict}
                type="button"
                onClick={() => setTab(verdict)}
                className={`rounded-full border px-3 py-1 text-xs ${
                  tab === verdict ? "border-ink-900 bg-ink-900 text-white" : counts[verdict] ? "border-ink-200 text-ink-700 hover:border-ink-400" : "border-ink-200/60 text-ink-500/50"
                }`}
              >
                <span className={`mr-1.5 inline-block h-2 w-2 rounded-full ${verdictStyles[verdict].dot}`} />
                {verdictStyles[verdict].label} · {counts[verdict]}
              </button>
            ))}
          </div>
          {shown.length === 0 ? (
            <p className="text-ink-500 text-sm font-light">
              {tab === "good"
                ? `None fits the request entirely yet.${counts.partly ? ` ${counts.partly} ${counts.partly === 1 ? "fits" : "fit"} in part.` : ""}`
                : "None here."}
            </p>
          ) : (
          <ul className="space-y-1.5">
            {shown.map((property) => (
              <li
                key={property.id}
                id={`suggestion-${property.id}`}
                onMouseEnter={() => setFocus(property.id)}
                className={`flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border px-3 py-2 ${focus === property.id ? "border-brand-300 bg-brand-50/40" : "border-ink-200/60"}`}
              >
                <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${verdictStyles[property.verdict].badge}`}>{verdictStyles[property.verdict].label}</span>
                <span className="min-w-0 flex-1">
                  <span className="text-ink-900 text-[13px] font-medium">{property.name}</span>
                  <span className="text-ink-500 ml-2 text-xs font-light">
                    {propertyTypeLabels[property.type]}
                    {property.stars ? ` · ${property.stars}★` : ""}
                  </span>
                  <span className="mt-0.5 block text-xs font-light">
                    {property.checks.map((check, index) => (
                      <span key={index} className={check.ok === false ? "text-[#c03654]" : check.ok === null ? "text-ink-400" : "text-ink-700"}>
                        {index > 0 && <span className="text-ink-300"> · </span>}
                        {check.ok === true && property.km !== null && index === 0 && property.km <= NEAR_KM ? "✓ " : ""}
                        {check.text}
                      </span>
                    ))}
                  </span>
                </span>
                <span className="flex items-center gap-3 text-xs">
                  <Link href={`/properties/${property.id}${eventId ? `?back=${encodeURIComponent(`/events/${eventId}`)}` : ""}`} className="text-brand-700 hover:underline">
                    Open
                  </Link>
                  {eventId &&
                    (property.onEvent ? (
                      <span className="text-ink-500">On {eventName}</span>
                    ) : (
                      <button
                        type="button"
                        disabled={add.isPending}
                        onClick={() => add.mutate({ eventId, propertyId: property.id })}
                        className="text-brand-700 font-medium hover:underline"
                      >
                        Add to {eventName}
                      </button>
                    ))}
                </span>
              </li>
            ))}
          </ul>
          )}
          </>
        )}
      </div>

      {targets.length > 0 && (
        <NotInSystem
          salesRequestId={salesRequestId}
          eventName={eventName}
          radiusKm={radiusKm}
          setRadiusKm={setRadiusKm}
          loading={discover.isLoading}
          failed={discover.isError}
          failedMessage={discover.error?.message ?? null}
          onRetry={() => void discover.refetch()}
          source={discover.data?.source ?? null}
          found={found}
          adder={addFound}
          focus={focus}
          setFocus={setFocus}
        />
      )}
    </div>
  );
}

/** How far to search for places not in the system: 5 km first, wider when asked. */
const radiusOptions = [5, 10, 20];

type FoundPlace = RouterOutputs["sales"]["sourcingDiscover"]["found"][number];

/**
 * Places to stay near the client's places that are not among our properties
 * (doc §4.11), found on the map — each added to our properties, and to the
 * event, in one click.
 */
function NotInSystem({
  salesRequestId,
  eventName,
  radiusKm,
  setRadiusKm,
  loading,
  failed,
  failedMessage,
  onRetry,
  source,
  found,
  adder,
  focus,
  setFocus,
}: {
  salesRequestId: string;
  eventName: string | null;
  radiusKm: number;
  setRadiusKm: (km: number) => void;
  loading: boolean;
  failed: boolean;
  failedMessage: string | null;
  onRetry: () => void;
  source: "google" | "osm" | null;
  found: FoundPlace[];
  adder: Adder;
  focus: string | null;
  setFocus: (key: string) => void;
}) {
  const [all, setAll] = useState(false);
  const shown = all ? found : found.slice(0, 8);

  return (
    <div>
      <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-ink-900 text-[14px] font-medium">Properties not in the system</h3>
        <span className="flex items-center gap-1.5 text-xs font-light">
          <span className="text-ink-500">Search within</span>
          {radiusOptions.map((km) => (
            <button
              key={km}
              type="button"
              onClick={() => setRadiusKm(km)}
              aria-pressed={radiusKm === km}
              className={`rounded-full border px-2.5 py-0.5 ${radiusKm === km ? "border-ink-900 bg-ink-900 text-white" : "border-ink-200 text-ink-700 hover:border-ink-500"}`}
            >
              {km} km
            </button>
          ))}
        </span>
      </div>
      <p className="text-ink-500 mb-2 text-xs font-light">
        {source === "osm"
          ? `Places to stay within ${radiusKm} km of the client's places, from OpenStreetMap — Google Maps search is not switched on for us yet, so this list is patchier than it will be. `
          : `Places to stay within ${radiusKm} km of the client's places, found on Google Maps. `}
        Rooms and prices are not known until we ask; add one to the properties board to start on it.
      </p>
      {loading ? (
        <p className="text-ink-500 text-sm font-light">Searching the map…</p>
      ) : failed ? (
        <p className="text-ink-500 text-sm font-light">
          {failedMessage ?? "The map search did not answer."}{" "}
          <button type="button" onClick={onRetry} className="text-brand-700 font-medium hover:underline">
            Try again
          </button>
        </p>
      ) : found.length === 0 ? (
        <p className="text-ink-500 text-sm font-light">{`Nothing new within ${radiusKm} km — every place to stay found there is already in our properties.${radiusKm < radiusOptions[radiusOptions.length - 1]! ? " Search wider above." : ""}`}</p>
      ) : (
        <>
          <ul className="space-y-1.5">
            {shown.map((place) => {
              return (
                <li
                  key={place.key}
                  id={`found-${place.key}`}
                  onMouseEnter={() => setFocus(place.key)}
                  className={`flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border px-3 py-2 ${focus === place.key ? "border-brand-300 bg-brand-50/40" : "border-ink-200/60"}`}
                >
                  <span className="min-w-0 flex-1">
                    <span className="text-ink-900 text-[13px] font-medium">{place.name}</span>
                    <span className="text-ink-500 ml-2 text-xs font-light">
                      {propertyTypeLabels[place.type]}
                      {place.stars ? ` · ${place.stars}★` : ""}
                      {place.rating ? ` · ${place.rating.toFixed(1)} rating${place.ratingCount ? ` (${place.ratingCount.toLocaleString("en")})` : ""}` : ""}
                      {place.priceLevel ? ` · ${place.priceLevel}` : ""}
                    </span>
                    <span className="mt-0.5 block text-xs font-light">
                      {/* What the map cannot know (rooms, prices) goes unsaid here — the note above says so. */}
                      {place.checks
                        .filter((check) => check.ok !== null)
                        .map((check, index) => (
                        <span key={index} className={check.ok === false ? "text-[#c03654]" : check.ok === null ? "text-ink-500/60" : "text-ink-700"}>
                          {index > 0 && <span className="text-ink-300"> · </span>}
                          {check.text}
                        </span>
                      ))}
                    </span>
                  </span>
                  <span className="flex items-center gap-3 text-xs">
                    <FoundActions place={place} eventName={eventName} adder={adder} />
                  </span>
                </li>
              );
            })}
          </ul>
          {found.length > 8 && (
            <button type="button" onClick={() => setAll(!all)} className="text-brand-700 mt-2 text-xs font-light hover:underline">
              {all ? "Show fewer" : `Show all ${found.length}`}
            </button>
          )}
          {adder.error && <p className="mt-2 text-xs text-[#c03654]">{adder.error}</p>}
        </>
      )}
    </div>
  );
}

/** Adding a place found on the map to our properties (and the event), shared by its row and its map card. */
function useAddFound(salesRequestId: string, source: "google" | "osm" | null) {
  const utils = api.useUtils();
  const [added, setAdded] = useState<Record<string, string>>({});
  const add = api.sales.addFound.useMutation({
    onSuccess: (property, variables) => {
      setAdded((current) => ({ ...current, [variables.place.name]: property.id }));
      void utils.sales.sourcing.invalidate();
    },
  });
  return {
    added,
    pending: add.isPending ? (add.variables?.place.name ?? null) : null,
    error: add.error?.message ?? null,
    add: (place: FoundPlace) =>
      add.mutate({
        salesRequestId,
        place: {
          name: place.name,
          type: place.type,
          latitude: place.latitude,
          longitude: place.longitude,
          address: place.address,
          city: place.city,
          country: place.country,
          website: place.website,
          phone: place.phone,
          stars: place.stars,
          rooms: place.rooms,
          source: source ?? "osm",
        },
      }),
  };
}
type Adder = ReturnType<typeof useAddFound>;

/** A found place's links and its Add to properties board button. */
function FoundActions({ place, eventName, adder }: { place: FoundPlace; eventName: string | null; adder: Adder }) {
  const propertyId = adder.added[place.name];
  return (
    <>
      <a href={place.mapUrl} target="_blank" rel="noreferrer" className="text-brand-700 hover:underline">
        Map ↗
      </a>
      {place.website && (
        <a href={place.website} target="_blank" rel="noreferrer" className="text-brand-700 hover:underline">
          Website ↗
        </a>
      )}
      {propertyId ? (
        <Link href={`/properties/${propertyId}`} className="font-medium text-[#0a7a47] hover:underline">
          ✓ Added — open
        </Link>
      ) : (
        <button
          type="button"
          disabled={adder.pending !== null}
          onClick={(e) => {
            e.stopPropagation();
            adder.add(place);
          }}
          title={eventName ? `Adds it to our properties and to ${eventName}` : "Adds it to our properties"}
          className="bg-brand-400 hover:bg-brand-500 rounded-full px-3 py-1 font-medium text-white disabled:opacity-60"
        >
          {adder.pending === place.name ? "Adding…" : "Add to properties board"}
        </button>
      )}
    </>
  );
}

/** The card over a dot on the map, while the pointer is on it. */
function MapCard({ children }: { children: React.ReactNode }) {
  return (
    <span
      className="border-ink-200 absolute bottom-full left-1/2 mb-1.5 block w-72 -translate-x-1/2 cursor-default rounded-lg border bg-white px-3 py-2.5 text-left whitespace-normal shadow-lg"
      onClick={(e) => e.stopPropagation()}
    >
      {children}
    </span>
  );
}
