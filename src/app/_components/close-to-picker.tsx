"use client";

import { AdvancedMarker, APIProvider, Map as GoogleMap, type MapMouseEvent } from "@vis.gl/react-google-maps";
import { useState } from "react";

import { Button, Input } from "~/app/_components/form";
import { env } from "~/env";

export type Point = { label: string; address: string; latitude: number; longitude: number };
type Place = { id: string; name: string; latitude?: number; longitude?: number };

const mapId = env.NEXT_PUBLIC_GOOGLE_MAPS_MAP_ID ?? "DEMO_MAP_ID";

/**
 * Places of the client's own to be close to (doc §4.11) — their office, a team
 * hotel — found by typing the address, or by clicking the spot on a map. Each
 * is kept with its position, so it can be measured from like the event's.
 */
export function CloseToPicker({
  points,
  onChange,
  places,
  find,
}: {
  points: Point[];
  onChange: (points: Point[]) => void;
  /** The event's own places, shown on the map for bearings. */
  places: Place[];
  /** An address → its position, or null when it cannot be found. */
  find: (address: string) => Promise<{ latitude: number; longitude: number; address: string | null } | null>;
}) {
  const [query, setQuery] = useState("");
  const [finding, setFinding] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [mapOpen, setMapOpen] = useState(false);
  // A spot clicked on the map, waiting for its name.
  const [pending, setPending] = useState<{ latitude: number; longitude: number } | null>(null);
  const [pendingName, setPendingName] = useState("");
  const apiKey = env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;

  const located = places.filter((place) => place.latitude != null && place.longitude != null);
  const all = [...located.map((place) => ({ lat: place.latitude!, lng: place.longitude! })), ...points.map((point) => ({ lat: point.latitude, lng: point.longitude }))];
  const center = all.length
    ? { lat: all.reduce((sum, p) => sum + p.lat, 0) / all.length, lng: all.reduce((sum, p) => sum + p.lng, 0) / all.length }
    : { lat: 34.05, lng: -118.25 };

  const add = async () => {
    const words = query.trim();
    if (words.length < 3) return;
    setProblem(null);
    setFinding(true);
    const found = await find(words).catch(() => null);
    setFinding(false);
    if (!found) {
      setProblem("That address could not be found — try adding the city, or pick the spot on the map.");
      return;
    }
    onChange([...points, { label: words.split(",")[0]!.trim(), address: found.address ?? words, latitude: found.latitude, longitude: found.longitude }]);
    setQuery("");
  };

  return (
    <div className="space-y-2">
      {points.length > 0 && (
        <ul className="space-y-1.5">
          {points.map((point, index) => (
            <li key={index} className="border-ink-200/60 flex items-center gap-2 rounded-lg border bg-white px-3 py-2">
              <span className="text-brand-700" aria-hidden>
                📍
              </span>
              <Input
                value={point.label}
                onChange={(e) => onChange(points.map((p, i) => (i === index ? { ...p, label: e.target.value } : p)))}
                aria-label={`Place ${index + 1} name`}
                className="w-48 py-1"
              />
              <span className="text-ink-500 min-w-0 flex-1 truncate text-xs font-light" title={point.address}>
                {point.address || `${point.latitude.toFixed(4)}, ${point.longitude.toFixed(4)}`}
              </span>
              <button type="button" onClick={() => onChange(points.filter((_, i) => i !== index))} aria-label="Remove" className="text-ink-400 text-lg leading-none hover:text-[#c03654]">
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="flex flex-wrap gap-2">
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              void add();
            }
          }}
          placeholder="Another place — type its address, like 1 World Way, Los Angeles"
          aria-label="Address of a place to be close to"
          className="min-w-0 flex-1"
        />
        <Button type="button" variant="secondary" disabled={finding || query.trim().length < 3} onClick={() => void add()}>
          {finding ? "Finding…" : "Add"}
        </Button>
        {apiKey && (
          <Button type="button" variant="ghost" onClick={() => setMapOpen(!mapOpen)}>
            {mapOpen ? "Hide the map" : "Pick on a map"}
          </Button>
        )}
      </div>
      {problem && <p className="text-xs text-[#c03654]">{problem}</p>}
      {mapOpen && apiKey && (
        <div className="space-y-2">
          <p className="text-ink-500 text-xs font-light">Click the spot you want to be close to.</p>
          <div className="border-ink-200/60 h-72 overflow-hidden rounded-lg border">
            <APIProvider apiKey={apiKey}>
              <GoogleMap
                mapId={mapId}
                defaultCenter={center}
                defaultZoom={located.length || points.length ? 11 : 10}
                gestureHandling="greedy"
                disableDefaultUI
                zoomControl
                onClick={(event: MapMouseEvent) => {
                  const spot = event.detail.latLng;
                  if (spot) {
                    setPending({ latitude: spot.lat, longitude: spot.lng });
                    setPendingName("");
                  }
                }}
              >
                {located.map((place) => (
                  <AdvancedMarker key={place.id} position={{ lat: place.latitude!, lng: place.longitude! }} title={place.name}>
                    <span className="bg-ink-700 rounded-full px-2 py-0.5 text-[11px] text-white shadow">{place.name}</span>
                  </AdvancedMarker>
                ))}
                {points.map((point, index) => (
                  <AdvancedMarker key={index} position={{ lat: point.latitude, lng: point.longitude }} title={point.label}>
                    <span className="bg-brand-400 rounded-full px-2 py-0.5 text-[11px] text-white shadow">{point.label}</span>
                  </AdvancedMarker>
                ))}
                {pending && <AdvancedMarker position={{ lat: pending.latitude, lng: pending.longitude }} />}
              </GoogleMap>
            </APIProvider>
          </div>
          {pending && (
            <div className="flex flex-wrap gap-2">
              <Input
                value={pendingName}
                onChange={(e) => setPendingName(e.target.value)}
                placeholder="What is this place? Like Our office"
                aria-label="Name of the picked place"
                autoFocus
                className="min-w-0 flex-1"
              />
              <Button
                type="button"
                disabled={!pendingName.trim()}
                onClick={() => {
                  onChange([...points, { label: pendingName.trim(), address: "", ...pending }]);
                  setPending(null);
                }}
              >
                Add this place
              </Button>
              <Button type="button" variant="ghost" onClick={() => setPending(null)}>
                Cancel
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
