"use client";

import { AdvancedMarker, APIProvider, Map as GoogleMap, useMap } from "@vis.gl/react-google-maps";
import Link from "next/link";
import { useEffect, useState } from "react";

import { env } from "~/env";
import { propertyTypeLabels } from "~/lib/scouting";
import { NEAR_KM, WITHIN_KM } from "~/lib/sourcing-fit";
import { api } from "~/trpc/react";

const mapId = env.NEXT_PUBLIC_GOOGLE_MAPS_MAP_ID ?? "DEMO_MAP_ID";
const verdictStyles = {
  good: { dot: "bg-[#0a7a47]", badge: "bg-[#e3f8ee] text-[#0a7a47]", label: "Fits" },
  unclear: { dot: "bg-[#1d5fa8]", badge: "bg-[#e6f0fb] text-[#1d5fa8]", label: "Not enough known" },
  partly: { dot: "bg-[#e5a400]", badge: "bg-[#fff4e0] text-[#8a5a00]", label: "Fits in part" },
  poor: { dot: "bg-ink-400", badge: "bg-ink-50 text-ink-500", label: "Does not fit" },
} as const;

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
  const apiKey = env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;

  if (data.isLoading) return <p className="text-ink-500 text-sm font-light">Loading the map…</p>;
  if (!data.data) return null;
  const { targets, suggestions, fromEventPlaces, eventId, eventName } = data.data;
  const points = [...targets, ...suggestions.slice(0, 15)];
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
          Properties we already have are around them — green fits the request, blue may (not enough is known about it), amber fits in part.
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
              {suggestions.map((property) => (
                <AdvancedMarker
                  key={property.id}
                  position={{ lat: property.latitude, lng: property.longitude }}
                  title={property.name}
                  zIndex={focus === property.id ? 60 : 10}
                  onClick={() => {
                    setFocus(property.id);
                    document.getElementById(`suggestion-${property.id}`)?.scrollIntoView({ block: "nearest", behavior: "smooth" });
                  }}
                >
                  <span
                    className={`block rounded-full border-2 border-white shadow ${verdictStyles[property.verdict].dot} ${focus === property.id ? "h-5 w-5" : "h-3.5 w-3.5"}`}
                  />
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
            None within {WITHIN_KM * 2} km yet. Scout new ones on {eventName ? `${eventName}'s` : "the event's"} Properties tab.
          </p>
        ) : (
          <ul className="space-y-1.5">
            {suggestions.map((property) => (
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
      </div>
    </div>
  );
}
