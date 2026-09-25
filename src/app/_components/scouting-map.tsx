"use client";

import {
  AdvancedMarker,
  APIProvider,
  Map as GoogleMap,
  useMap,
} from "@vis.gl/react-google-maps";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import type { PlaceCategory, ScoutingStatus } from "generated/prisma";

import { env } from "~/env";
import { formatDay } from "~/lib/format";
import { placeCategoryLabels, scoutingStatusLabels } from "~/lib/scouting";
import { api } from "~/trpc/react";

export type MapPin = {
  id: string;
  /** The property itself, which is what availability and travel times are for. */
  propertyId: string;
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
  stars?: number | null;
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

/** What the map needs of §5.3's availability figures, per room category. */
export type MapAvailability = {
  propertyId: string;
  categoryId: string;
  categoryName: string;
  from: Date;
  to: Date;
  slots: number;
  offerable: number;
  genuinelyFree: number;
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

/**
 * Properties are what this map is *for*, so they are drawn larger than the
 * places of interest around them and sit above them. Google's own labels
 * compete for attention at every zoom; a property has to win that (doc §3.8).
 */
function Marker({
  color,
  place = false,
  selected = false,
}: {
  color: string;
  place?: boolean;
  selected?: boolean;
}) {
  const size = place ? 16 : 20;
  return (
    <span
      style={{
        display: "block",
        width: size,
        height: size,
        borderRadius: place ? 4 : "50%",
        background: color,
        border: `${place ? 2.5 : 3}px solid #fff`,
        boxShadow: selected
          ? `0 0 0 4px ${color}55, 0 2px 6px rgba(0,0,0,.4)`
          : "0 1px 4px rgba(0,0,0,.35)",
        // Centre the marker on the point rather than hanging it above.
        transform: `translateY(50%) scale(${selected ? 1.25 : 1})`,
        transition: "transform .12s ease",
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

/** "23 min", "1 h 05". Anything under a minute is still a minute's walk away. */
function formatDuration(seconds: number) {
  const minutes = Math.max(1, Math.round(seconds / 60));
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  return `${hours} h ${String(minutes % 60).padStart(2, "0")}`;
}

const formatKm = (metres: number) =>
  `${(metres / 1000).toFixed(metres < 10_000 ? 1 : 0)} km`;

function PanelHeading({ children }: { children: React.ReactNode }) {
  return (
    <h4 className="text-ink-500 mb-2 text-[11px] font-medium tracking-wider uppercase">
      {children}
    </h4>
  );
}

/**
 * How long it takes to get to each place of interest, by bike, car and public
 * transport (doc §3.8). Asked for only when a property is opened, and never
 * stored — Google's terms forbid keeping these.
 */
function TravelTimes({
  propertyId,
  eventId,
  places,
}: {
  propertyId: string;
  eventId: string;
  places: MapPlace[];
}) {
  const travel = api.travel.fromProperty.useQuery(
    { propertyId, eventId },
    { enabled: places.length > 0, staleTime: 0 },
  );

  if (places.length === 0) {
    return (
      <p className="text-ink-500 text-xs font-light">
        No places of interest on this event yet — add a venue, an airport or a
        station and travel times appear here.
      </p>
    );
  }

  if (travel.isPending) {
    return (
      <p className="text-ink-500 text-xs font-light">Asking Google…</p>
    );
  }

  if (travel.isError) {
    return (
      <p className="text-ink-500 text-xs font-light">
        Travel times are not available right now.
      </p>
    );
  }

  const byPlace = new Map(travel.data.map((row) => [row.placeId, row]));

  return (
    <div className="space-y-3">
      {places.map((place) => {
        const legs = byPlace.get(place.id);
        const modes = [
          { label: "Bike", leg: legs?.bike ?? null },
          { label: "Car", leg: legs?.car ?? null },
          { label: "Transport", leg: legs?.transit ?? null },
        ];

        return (
          <div key={place.id}>
            <div className="flex items-baseline gap-2">
              <span
                className="mt-0.5 inline-block h-2.5 w-2.5 shrink-0 rounded-sm"
                style={{ background: placeColors[place.category] }}
              />
              <span className="text-ink-900 text-[13px] font-light">
                {place.name}
              </span>
            </div>
            <dl className="mt-1 ml-[18px] grid grid-cols-3 gap-2">
              {modes.map((mode) => (
                <div key={mode.label}>
                  <dt className="text-ink-500 text-[10px] font-light">
                    {mode.label}
                  </dt>
                  <dd className="text-ink-900 text-[13px] font-light">
                    {mode.leg ? (
                      <>
                        {formatDuration(mode.leg.seconds)}
                        <span className="text-ink-500 block text-[10px] font-light">
                          {formatKm(mode.leg.metres)}
                        </span>
                      </>
                    ) : (
                      <span className="text-ink-500 text-[11px]">
                        not available
                      </span>
                    )}
                  </dd>
                </div>
              ))}
            </dl>
          </div>
        );
      })}
      <p className="text-ink-500 text-[10px] font-light">
        Google&rsquo;s estimate for an ordinary weekday morning. Car times
        ignore live traffic.
      </p>
    </div>
  );
}

/**
 * What we can still offer here, per room category — the conservative figure of
 * §5.3: whole rooms free on every night of the window, with blocks counted as
 * taken. A property we have not contracted has nothing held, which is a
 * different thing from having none left.
 */
function RoomsAvailable({ rows }: { rows: MapAvailability[] }) {
  if (rows.length === 0) {
    return (
      <p className="text-ink-500 text-xs font-light">
        Not contracted yet — nothing held here.
      </p>
    );
  }

  return (
    <ul className="space-y-2">
      {rows.map((row) => (
        <li key={row.categoryId}>
          <div className="text-ink-900 text-[13px] font-light">
            <span className="font-medium">{row.genuinelyFree}</span> of{" "}
            {row.slots} free
            <span className="text-ink-500">
              {" "}
              every night {formatDay(row.from)} – {formatDay(row.to)}
            </span>
          </div>
          <div className="text-ink-500 text-[11px] font-light">
            {row.categoryName}
            {row.offerable > row.genuinelyFree && (
              <> · up to {row.offerable} if blocks lapse</>
            )}
          </div>
        </li>
      ))}
    </ul>
  );
}

/** The panel beside the map: what this pin actually is, and what it is worth. */
function SidePanel({
  pin,
  place,
  places,
  availability,
  eventId,
  onClose,
}: {
  pin?: MapPin;
  place?: MapPlace;
  places: MapPlace[];
  availability: MapAvailability[];
  eventId?: string;
  onClose: () => void;
}) {
  return (
    <aside className="border-ink-200/60 flex h-[20rem] w-full flex-col overflow-y-auto border-t bg-white p-4 md:h-[32rem] md:w-80 md:shrink-0 md:border-t-0 md:border-l">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h3 className="text-ink-900 text-[15px] font-normal">
            {pin?.name ?? place?.name}
          </h3>
          <p className="text-ink-500 text-xs font-light">
            {pin
              ? [pin.subtitle, pin.stars ? `${pin.stars}-star` : null]
                  .filter(Boolean)
                  .join(" · ")
              : place && placeCategoryLabels[place.category]}
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="text-ink-500 hover:text-ink-900 -mt-1 px-1 text-lg leading-none"
        >
          ×
        </button>
      </div>

      {pin && (
        <>
          {pin.status && (
            <p
              className="mt-1 text-[13px] font-light"
              style={{ color: pinColor(pin.status) }}
            >
              {scoutingStatusLabels[pin.status]}
            </p>
          )}

          <Link
            href={pin.href}
            className="text-brand-700 mt-1 text-[13px] font-light underline"
          >
            Open →
          </Link>

          <div className="mt-5">
            <PanelHeading>Rooms still available</PanelHeading>
            <RoomsAvailable
              rows={availability.filter(
                (row) => row.propertyId === pin.propertyId,
              )}
            />
          </div>

          <div className="mt-5">
            <PanelHeading>Getting there</PanelHeading>
            {eventId ? (
              <TravelTimes
                propertyId={pin.propertyId}
                eventId={eventId}
                places={places}
              />
            ) : (
              <p className="text-ink-500 text-xs font-light">
                Travel times are shown on an event&rsquo;s own map, where the
                places of interest live.
              </p>
            )}
          </div>
        </>
      )}

      {place && (
        <div className="mt-4">
          {place.lines ? (
            <>
              <PanelHeading>Lines</PanelHeading>
              <p className="text-ink-900 text-[13px] font-light">
                {place.lines}
              </p>
            </>
          ) : (
            <p className="text-ink-500 text-xs font-light">
              Open a property to see how long it takes to get here.
            </p>
          )}
        </div>
      )}
    </aside>
  );
}

export function ScoutingMap({
  pins,
  places = [],
  availability = [],
  eventId,
}: {
  pins: MapPin[];
  places?: MapPlace[];
  availability?: MapAvailability[];
  eventId?: string;
}) {
  const [openId, setOpenId] = useState<string | null>(null);

  /**
   * A click on a pin also reaches the map, whose own handler closes the panel
   * again — so a panel opened and shut in the same click, and nothing ever
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
    <div className="border-ink-200/60 flex flex-col overflow-hidden rounded-xl border md:flex-row">
      <div className="min-w-0 flex-1">
        <APIProvider apiKey={apiKey}>
          <GoogleMap
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
                zIndex={10}
                clickable
                onClick={() => openPin(place.id)}
              >
                <Marker
                  color={placeColors[place.category]}
                  place
                  selected={openId === place.id}
                />
              </AdvancedMarker>
            ))}

            {pins.map((pin) => (
              <AdvancedMarker
                key={pin.id}
                position={{ lat: pin.latitude, lng: pin.longitude }}
                title={pin.name}
                // Properties sit above the places they are measured against.
                zIndex={openId === pin.id ? 1000 : 100}
                clickable
                onClick={() => openPin(pin.id)}
              >
                <Marker
                  color={pinColor(pin.status)}
                  selected={openId === pin.id}
                />
              </AdvancedMarker>
            ))}
          </GoogleMap>
        </APIProvider>
      </div>

      {(openProperty ?? openPlace) && (
        <SidePanel
          pin={openProperty}
          place={openPlace}
          places={places}
          availability={availability}
          eventId={eventId}
          onClose={() => setOpenId(null)}
        />
      )}
    </div>
  );
}
