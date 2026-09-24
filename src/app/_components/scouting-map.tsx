"use client";

import {
  AdvancedMarker,
  APIProvider,
  InfoWindow,
  Map,
  useMap,
} from "@vis.gl/react-google-maps";
import { useEffect, useMemo, useRef, useState } from "react";
import type { PlaceCategory, ScoutingStatus } from "generated/prisma";

import { env } from "~/env";
import { placeCategoryLabels, scoutingStatusLabels } from "~/lib/scouting";

export type MapPin = {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  /**
   * Only set where the map is scoped to one event. The property library's own
   * map leaves it out: a property can be on several events' lists at once with
   * a different status on each, so there is no one status to paint it with
   * (doc §3.5).
   */
  status?: ScoutingStatus;
  subtitle: string;
  href: string;
};

declare global {
  interface Window {
    /** Google calls this when it rejects the key (see `keyRefused` below). */
    gm_authFailure?: () => void;
  }
}

/** A place guests need to get to, drawn alongside the properties (doc §3.7). */
export type MapPlace = {
  id: string;
  name: string;
  category: PlaceCategory;
  lines: string | null;
  latitude: number;
  longitude: number;
};

type Point = { lat: number; lng: number };

const pinColors: Record<ScoutingStatus, string> = {
  PROSPECT: "#8a8a8a",
  CONTACTED: "#614fc9",
  SHORTLISTED: "#ab6ce2",
  REJECTED: "#db4b68",
  CONTRACTED: "#12b878",
};

/** What a pin with no status is drawn in. */
const NEUTRAL_PIN = "#614fc9";

const pinColor = (status?: ScoutingStatus) =>
  status ? pinColors[status] : NEUTRAL_PIN;

/**
 * Places of interest are squares, not dots, so a venue is never mistaken for a
 * hotel at a glance. Colour separates one kind of place from another.
 */
const placeColors: Record<PlaceCategory, string> = {
  VENUE: "#292929",
  TRAIN_STATION: "#1f6feb",
  AIRPORT: "#0d8f5d",
  IBC: "#b8860b",
  OTHER: "#6b6b6b",
};

/**
 * Advanced markers need a map ID. Google's demo ID works without any setup;
 * a map ID of our own only matters once the map is styled (doc §3.8).
 */
const mapId = env.NEXT_PUBLIC_GOOGLE_MAPS_MAP_ID ?? "DEMO_MAP_ID";

/** A coloured dot carries the status, as it did on the previous map. */
function Dot({ color, place = false }: { color: string; place?: boolean }) {
  const size = place ? 18 : 14;
  return (
    <span
      style={{
        display: "block",
        width: size,
        height: size,
        borderRadius: place ? 4 : "50%",
        background: color,
        border: `${place ? 3 : 2}px solid #fff`,
        boxShadow: "0 1px 4px rgba(0,0,0,.35)",
        // Centre the dot on the point rather than hanging it above it.
        transform: "translateY(50%)",
      }}
    />
  );
}

/** Keeps every pin in frame, including when the filters change the set. */
function FitBounds({ points }: { points: Point[] }) {
  const map = useMap();

  useEffect(() => {
    if (!map || points.length === 0) return;
    if (points.length === 1) {
      map.setCenter(points[0]!);
      map.setZoom(13);
      return;
    }
    const lats = points.map((point) => point.lat);
    const lngs = points.map((point) => point.lng);
    map.fitBounds(
      {
        north: Math.max(...lats),
        south: Math.min(...lats),
        east: Math.max(...lngs),
        west: Math.min(...lngs),
      },
      40,
    );
  }, [map, points]);

  return null;
}

/** The notice that stands in for the map when it cannot be drawn. */
function MapNotice({ children }: { children: React.ReactNode }) {
  return (
    <div className="border-ink-200/60 text-ink-500 flex h-[32rem] items-center justify-center rounded-xl border bg-white px-6 text-center text-sm font-light">
      {children}
    </div>
  );
}

export function ScoutingMap({
  pins,
  places = [],
}: {
  pins: MapPin[];
  places?: MapPlace[];
}) {
  const [openId, setOpenId] = useState<string | null>(null);

  /**
   * A click on a pin also reaches the map, whose own handler closes the popup
   * again — so a popup opened and shut in the same click, and nothing ever
   * appeared. Google's marker click carries no browser event to stop, so the
   * map ignores a click that lands immediately after one on a pin.
   */
  const pinClickedAt = useRef(0);
  const openPin = (id: string) => {
    pinClickedAt.current = Date.now();
    setOpenId(id);
  };

  /**
   * Google rejects a key by calling this global rather than by failing the
   * load, and draws an empty grey square. Without this the reader is left
   * guessing; the usual cause is the web address missing from the key's
   * allowed list.
   */
  const [keyRefused, setKeyRefused] = useState(false);
  useEffect(() => {
    window.gm_authFailure = () => setKeyRefused(true);
    return () => {
      delete window.gm_authFailure;
    };
  }, []);

  const points = useMemo<Point[]>(
    () => [
      ...pins.map((pin) => ({ lat: pin.latitude, lng: pin.longitude })),
      ...places.map((place) => ({ lat: place.latitude, lng: place.longitude })),
    ],
    [pins, places],
  );

  const apiKey = env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;
  if (!apiKey) {
    return <MapNotice>The map needs a Google Maps key — see docs/todos.md.</MapNotice>;
  }

  if (keyRefused) {
    return (
      <MapNotice>
        Google refused the map key for this address
        {typeof window === "undefined" ? "" : ` (${window.location.origin})`}.
        Add it to the key&rsquo;s allowed websites in Google Cloud — see
        docs/todos.md.
      </MapNotice>
    );
  }

  const openProperty = pins.find((pin) => pin.id === openId);
  const openPlace = places.find((place) => place.id === openId);

  return (
    <div className="border-ink-200/60 overflow-hidden rounded-xl border">
      <APIProvider apiKey={apiKey}>
        <Map
          mapId={mapId}
          defaultCenter={points[0] ?? { lat: 46.8182, lng: 8.2275 }}
          defaultZoom={points.length ? 12 : 6}
          gestureHandling="greedy"
          clickableIcons={false}
          onClick={() => {
            if (Date.now() - pinClickedAt.current < 300) return;
            setOpenId(null);
          }}
          style={{ height: "32rem", width: "100%" }}
        >
          <FitBounds points={points} />

          {places.map((place) => (
            <AdvancedMarker
              key={place.id}
              position={{ lat: place.latitude, lng: place.longitude }}
              title={place.name}
              zIndex={1000}
              clickable
              onClick={() => openPin(place.id)}
            >
              <Dot color={placeColors[place.category]} place />
            </AdvancedMarker>
          ))}

          {pins.map((pin) => (
            <AdvancedMarker
              key={pin.id}
              position={{ lat: pin.latitude, lng: pin.longitude }}
              title={pin.name}
              clickable
              onClick={() => openPin(pin.id)}
            >
              <Dot color={pinColor(pin.status)} />
            </AdvancedMarker>
          ))}

          {openPlace && (
            <InfoWindow
              position={{ lat: openPlace.latitude, lng: openPlace.longitude }}
              pixelOffset={[0, -6]}
              onCloseClick={() => setOpenId(null)}
            >
              <strong>{openPlace.name}</strong>
              <br />
              <span style={{ color: placeColors[openPlace.category] }}>
                {placeCategoryLabels[openPlace.category]}
              </span>
              {openPlace.lines && (
                <>
                  <br />
                  {openPlace.lines}
                </>
              )}
            </InfoWindow>
          )}

          {openProperty && (
            <InfoWindow
              position={{
                lat: openProperty.latitude,
                lng: openProperty.longitude,
              }}
              pixelOffset={[0, -6]}
              onCloseClick={() => setOpenId(null)}
            >
              <strong>{openProperty.name}</strong>
              <br />
              {openProperty.subtitle}
              <br />
              {openProperty.status && (
                <>
                  <span style={{ color: pinColor(openProperty.status) }}>
                    {scoutingStatusLabels[openProperty.status]}
                  </span>
                  <br />
                </>
              )}
              <a href={openProperty.href}>Open →</a>
            </InfoWindow>
          )}
        </Map>
      </APIProvider>
    </div>
  );
}
