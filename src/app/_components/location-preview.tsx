"use client";

import { AdvancedMarker, APIProvider, Map as GoogleMap, useMap } from "@vis.gl/react-google-maps";
import { useEffect } from "react";

import { env } from "~/env";

const mapId = env.NEXT_PUBLIC_GOOGLE_MAPS_MAP_ID ?? "DEMO_MAP_ID";

/** Parse the coordinates as typed; null until both are real numbers in range. */
function parse(latitude: string, longitude: string) {
  const lat = Number(latitude.replace(",", "."));
  const lng = Number(longitude.replace(",", "."));
  if (!latitude.trim() || !longitude.trim() || !Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  return { lat, lng };
}

/** Keeps the map on the pin when the coordinates are typed or looked up. */
function FollowPin({ position }: { position: { lat: number; lng: number } }) {
  const map = useMap();
  useEffect(() => {
    map?.panTo(position);
  }, [map, position.lat, position.lng]); // eslint-disable-line react-hooks/exhaustive-deps -- follow the numbers, not the object
  return null;
}

/**
 * A small map with a pin on the coordinates being entered, so it is plain
 * whether they point at the right place (doc §3.7, §3.8). The pin can be
 * dragged to correct them. Nothing is shown until both coordinates are there.
 */
export function LocationPreview({
  latitude,
  longitude,
  onMove,
}: {
  latitude: string;
  longitude: string;
  /** Called with the new coordinates when the pin is dragged. */
  onMove: (latitude: string, longitude: string) => void;
}) {
  const position = parse(latitude, longitude);
  const apiKey = env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;

  if (!position) {
    return (
      <p className="text-ink-500 text-xs font-light">
        Once there is a latitude and a longitude, a map shows the spot here, to check it is the right one.
      </p>
    );
  }
  if (!apiKey) {
    return <p className="text-ink-500 text-xs font-light">The map needs a Google Maps key — see docs/todos.md.</p>;
  }

  return (
    <div>
      <div className="border-ink-200/60 overflow-hidden rounded-lg border">
        <APIProvider apiKey={apiKey}>
          <GoogleMap
            mapId={mapId}
            defaultCenter={position}
            defaultZoom={15}
            gestureHandling="cooperative"
            clickableIcons={false}
            style={{ height: "16rem", width: "100%" }}
          >
            <FollowPin position={position} />
            <AdvancedMarker
              position={position}
              draggable
              onDragEnd={(event) => {
                const moved = event.latLng;
                if (moved) onMove(moved.lat().toFixed(7), moved.lng().toFixed(7));
              }}
            />
          </GoogleMap>
        </APIProvider>
      </div>
      <p className="text-ink-500 mt-1 text-xs font-light">Wrong spot? Drag the pin, and the coordinates follow.</p>
    </div>
  );
}
