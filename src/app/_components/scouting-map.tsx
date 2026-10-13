"use client";

import {
  AdvancedMarker,
  APIProvider,
  Map as GoogleMap,
  useMap,
  useMapsLibrary,
} from "@vis.gl/react-google-maps";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import type { PlaceCategory, PropertyType, ScoutingStatus } from "generated/prisma";

import { env } from "~/env";
import { formatDay } from "~/lib/format";
import { placeIcon } from "~/lib/place-icons";
import { placeCategoryLabels, scoutingStatusLabels } from "~/lib/scouting";
import { AddPropertyForm } from "~/app/_components/add-property-on-map";
import { LayersPanel } from "~/app/_components/map-layers";
import { TravelTimes } from "~/app/_components/travel-times";
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
  /** Hotel and aparthotel a bed, apartment a house (2026-10-13). */
  type?: PropertyType;
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
  /** Its map layer (doc §3.7): which, its colour, and whether distances are measured to it. */
  layerId?: string | null;
  color?: string | null;
  measured?: boolean;
  /** For its icon: its layer's name and its notes, where the sport is often said. */
  layerName?: string | null;
  notes?: string | null;
};

/** A layer of the event's map (doc §3.7): its places shown or hidden together. */
export type MapLayer = { id: string; name: string; color: string; measured: boolean };

/** Google's own public transport — every metro, rail and bus line with its stations — on or off. */
function TransitLayer({ on }: { on: boolean }) {
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
 * What shows on the map (doc §3.7), as in Google My Maps: each layer, our
 * properties and public transport, ticked on or off — remembered per event in
 * this browser. Public transport starts off.
 */
function useShown(eventId: string | undefined, layers: MapLayer[]) {
  const key = `welodge:map-layers:${eventId ?? "none"}`;
  const [hidden, setHidden] = useState<string[]>([]);
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(key);
      if (raw) setHidden(JSON.parse(raw) as string[]);
    } catch {
      // Storage off: everything shows.
    }
  }, [key]);
  const save = (next: string[]) => {
    setHidden(next);
    try {
      window.localStorage.setItem(key, JSON.stringify(next));
    } catch {
      // As above.
    }
  };
  const ids = [...layers.map((layer) => layer.id), "properties"];
  return {
    isShown: (id: string) => (id === "transit" ? hidden.includes("transit:on") : !hidden.includes(id)),
    toggle: (id: string) =>
      id === "transit"
        ? save(hidden.includes("transit:on") ? hidden.filter((one) => one !== "transit:on") : [...hidden, "transit:on"])
        : save(hidden.includes(id) ? hidden.filter((one) => one !== id) : [...hidden, id]),
    showAll: () => save(["transit:on"]),
    hideAll: () => save(ids),
  };
}

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

/**
 * A property's colour on the map (doc §3.7, 2026-10-13): apartments purple;
 * hotels and aparthotels by their stars — five black, four blue, three green,
 * two or fewer yellow, unknown grey.
 */
export const propertyColor = (pin: { type?: PropertyType; stars?: number | null }) =>
  pin.type === "APARTMENT"
    ? "#8f5bd6"
    : !pin.stars
      ? "#8a8a8a"
      : pin.stars >= 5
        ? "#1d1d1f"
        : pin.stars === 4
          ? "#1d5fa8"
          : pin.stars === 3
            ? "#0a7a47"
            : "#e5a400";

const pinColor = (status?: ScoutingStatus) =>
  status ? pinColors[status] : NEUTRAL_PIN;

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

function PanelHeading({ children }: { children: React.ReactNode }) {
  return (
    <h4 className="text-ink-500 mb-2 text-[11px] font-medium tracking-wider uppercase">
      {children}
    </h4>
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

          {eventId && <ContactTaskBox key={pin.propertyId} propertyId={pin.propertyId} eventId={eventId} />}

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
  found = [],
  renderFound,
  searchPoint = null,
  layers = [],
  onlyPlaceId = null,
}: {
  pins: MapPin[];
  places?: MapPlace[];
  availability?: MapAvailability[];
  eventId?: string;
  /** Places to stay not in our system, from a search on the map — hollow purple dots (doc §3.9). */
  found?: { key: string; name: string; latitude: number; longitude: number }[];
  /** What a found place's panel says and offers. */
  renderFound?: (key: string) => React.ReactNode;
  /** The custom address being searched around — pinned while the search lasts. */
  searchPoint?: { label: string; latitude: number; longitude: number } | null;
  /** The event's map layers (doc §3.7) — with them, a Layers panel to show or hide each. */
  layers?: MapLayer[];
  /** A place chosen to search around: shown alone, the others hidden meanwhile. */
  onlyPlaceId?: string | null;
}) {
  const shown = useShown(eventId, layers);
  // A place on a hidden layer is not drawn; one on no layer always is.
  const visiblePlaces = onlyPlaceId
    ? places.filter((place) => place.id === onlyPlaceId)
    : places.filter((place) => !place.layerId || shown.isShown(place.layerId));
  const showProperties = shown.isShown("properties");
  // A place being added from the Layers panel: its spot, and whether the next map click sets it.
  const [draftPoint, setDraftPoint] = useState<{ latitude: number; longitude: number } | null>(null);
  const [picking, setPicking] = useState(false);
  // A property added by pointing at the map: the form open, its spot, and whether the next click sets it.
  const [addingProperty, setAddingProperty] = useState(false);
  const [propertyPoint, setPropertyPoint] = useState<{ latitude: number; longitude: number } | null>(null);
  const [pickingProperty, setPickingProperty] = useState(false);
  // Full screen takes the whole map — the Layers panel and a property's card with it — not Google's map alone.
  const frame = useRef<HTMLDivElement>(null);
  const [fullScreen, setFullScreen] = useState(false);
  useEffect(() => {
    const changed = () => setFullScreen(document.fullscreenElement === frame.current && frame.current !== null);
    document.addEventListener("fullscreenchange", changed);
    return () => document.removeEventListener("fullscreenchange", changed);
  }, []);
  const toggleFullScreen = () => {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void frame.current?.requestFullscreen();
  };
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
      // Around a chosen place, the map frames it and what was found near it — not every property.
      ...(onlyPlaceId ? [] : pins).map((pin) => ({ lat: pin.latitude, lng: pin.longitude })),
      ...(onlyPlaceId ? places.filter((place) => place.id === onlyPlaceId) : places).map((place) => ({ lat: place.latitude, lng: place.longitude })),
      ...found.map((place) => ({ lat: place.latitude, lng: place.longitude })),
      ...(searchPoint ? [{ lat: searchPoint.latitude, lng: searchPoint.longitude }] : []),
    ],
    [pins, places, found, searchPoint, onlyPlaceId],
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
    <div ref={frame} className="border-ink-200/60 flex flex-col overflow-hidden rounded-xl border bg-white md:flex-row">
      <div className="relative min-w-0 flex-1">
        {eventId && !addingProperty && (
          <button
            type="button"
            onClick={() => {
              setOpenId(null);
              setAddingProperty(true);
              setPickingProperty(true);
            }}
            className="bg-brand-400 hover:bg-brand-500 absolute top-2.5 left-1/2 z-10 -translate-x-1/2 rounded-full px-4 py-2 text-[13px] font-medium text-white shadow-md"
          >
            ＋ Add to the map
          </button>
        )}
        {pickingProperty && (
          <p className="bg-ink-900 absolute top-14 left-1/2 z-10 -translate-x-1/2 rounded-full px-3 py-1.5 text-xs text-white shadow-md">Click the spot on the map</p>
        )}
        <button
          type="button"
          onClick={toggleFullScreen}
          title={fullScreen ? "Leave full screen" : "Full screen — with the layers"}
          aria-label={fullScreen ? "Leave full screen" : "Full screen"}
          className="text-ink-700 hover:text-ink-900 absolute top-2.5 right-2.5 z-10 flex h-10 w-10 items-center justify-center rounded-sm bg-white text-lg shadow-md"
        >
          {fullScreen ? "✕" : "⛶"}
        </button>
        {eventId && (
          <LayersPanel
            eventId={eventId}
            layers={layers}
            places={places}
            shown={shown}
            draftPoint={draftPoint}
            setDraftPoint={setDraftPoint}
            picking={picking}
            setPicking={setPicking}
          />
        )}
        <APIProvider apiKey={apiKey}>
          <GoogleMap
            mapId={mapId}
            defaultCenter={points[0] ?? { lat: 46.8182, lng: 8.2275 }}
            defaultZoom={points.length ? 12 : 6}
            gestureHandling="greedy"
            clickableIcons={false}
            onClick={(event) => {
              if (pickingProperty && event.detail.latLng) {
                setPropertyPoint({ latitude: event.detail.latLng.lat, longitude: event.detail.latLng.lng });
                setPickingProperty(false);
                return;
              }
              if (picking && event.detail.latLng) {
                setDraftPoint({ latitude: event.detail.latLng.lat, longitude: event.detail.latLng.lng });
                setPicking(false);
                return;
              }
              if (Date.now() - pinClickedAt.current < 300) return;
              setOpenId(null);
            }}
            draggableCursor={picking || pickingProperty ? "crosshair" : undefined}
            fullscreenControl={false}
            style={{ height: fullScreen ? "100vh" : "32rem", width: "100%" }}
          >
            <FitBounds points={points} />
            <TransitLayer on={shown.isShown("transit")} />

            {visiblePlaces.map((place) => (
              <AdvancedMarker
                key={place.id}
                position={{ lat: place.latitude, lng: place.longitude }}
                title={place.name}
                zIndex={10}
                clickable
                onClick={() => openPin(place.id)}
              >
                {/* An icon in its layer's colour — its sport where it has one — named on pointing at it (2026-10-13). */}
                <span className="group relative block translate-y-1/2">
                  <span
                    className={`flex h-7 w-7 items-center justify-center rounded-full border-2 border-white text-[14px] leading-none shadow-md transition-transform group-hover:scale-110 ${openId === place.id ? "ring-brand-300 scale-110 ring-4" : ""}`}
                    style={{ background: place.color ?? "#9b1c31" }}
                  >
                    {placeIcon(place)}
                  </span>
                  <span className="bg-ink-900 pointer-events-none absolute bottom-full left-1/2 mb-1.5 hidden -translate-x-1/2 rounded-full px-2.5 py-1 text-[12px] font-medium whitespace-nowrap text-white shadow-lg group-hover:block">
                    {place.name}
                  </span>
                </span>
              </AdvancedMarker>
            ))}

            {(showProperties ? pins : []).map((pin) => (
              <AdvancedMarker
                key={pin.id}
                position={{ lat: pin.latitude, lng: pin.longitude }}
                title={pin.name}
                // Properties sit above the places they are measured against.
                zIndex={openId === pin.id ? 1000 : 100}
                clickable
                onClick={() => openPin(pin.id)}
              >
                {/* Our property (2026-10-13): a bed for a hotel, a house for an apartment, coloured by its stars. */}
                <span className="group relative block translate-y-1/2">
                  <span
                    className={`flex h-7 w-7 items-center justify-center rounded-md border-2 border-white text-[14px] leading-none shadow-md transition-transform group-hover:scale-110 ${openId === pin.id ? "ring-brand-300 scale-110 ring-4" : ""}`}
                    style={{ background: propertyColor(pin) }}
                  >
                    {pin.type === "APARTMENT" ? "🏠" : "🛏️"}
                  </span>
                  <span className="bg-ink-900 pointer-events-none absolute bottom-full left-1/2 mb-1.5 hidden -translate-x-1/2 rounded-full px-2.5 py-1 text-[12px] font-medium whitespace-nowrap text-white shadow-lg group-hover:block">
                    {pin.name}
                    {pin.stars ? ` · ${pin.stars}★` : ""}
                  </span>
                </span>
              </AdvancedMarker>
            ))}
            {found.map((place) => (
              <AdvancedMarker
                key={place.key}
                position={{ lat: place.latitude, lng: place.longitude }}
                title={`${place.name} — not in our system`}
                zIndex={openId === place.key ? 1000 : 50}
                clickable
                onClick={() => openPin(place.key)}
              >
                <span
                  className={`border-brand-500 block rounded-full border-2 bg-white shadow ${openId === place.key ? "h-4 w-4" : "h-3 w-3"}`}
                />
              </AdvancedMarker>
            ))}
            {propertyPoint && (
              <AdvancedMarker position={{ lat: propertyPoint.latitude, lng: propertyPoint.longitude }} title="The new property" zIndex={960}>
                <span className="block -translate-y-1/2 rounded-full bg-[#e5533d] px-2.5 py-1 text-[12px] font-medium whitespace-nowrap text-white shadow-lg">＋ New here</span>
              </AdvancedMarker>
            )}
            {draftPoint && (
              <AdvancedMarker position={{ lat: draftPoint.latitude, lng: draftPoint.longitude }} title="The new place" zIndex={950}>
                <span className="block -translate-y-1/2 rounded-full bg-[#e5533d] px-2.5 py-1 text-[12px] font-medium whitespace-nowrap text-white shadow-lg">＋ New place here</span>
              </AdvancedMarker>
            )}
            {searchPoint && (
              <AdvancedMarker position={{ lat: searchPoint.latitude, lng: searchPoint.longitude }} title={searchPoint.label} zIndex={900}>
                <span className="bg-brand-500 block max-w-64 truncate rounded-full px-2.5 py-1 text-[12px] font-medium whitespace-nowrap text-white shadow-lg">
                  📍 {searchPoint.label}
                </span>
              </AdvancedMarker>
            )}
          </GoogleMap>
        </APIProvider>
      </div>

      {addingProperty && eventId && (
        <aside className="border-ink-200/60 w-full shrink-0 overflow-y-auto border-t bg-white p-4 md:w-80 md:border-t-0 md:border-l">
          <AddPropertyForm
            eventId={eventId}
            layers={layers}
            point={propertyPoint}
            setPoint={setPropertyPoint}
            picking={pickingProperty}
            setPicking={setPickingProperty}
            onClose={() => {
              setAddingProperty(false);
              setPickingProperty(false);
              setPropertyPoint(null);
            }}
          />
        </aside>
      )}

      {openId && renderFound && found.some((place) => place.key === openId) && (
        <aside className="border-ink-200/60 w-full shrink-0 border-t bg-white p-4 md:w-80 md:border-t-0 md:border-l">
          <div className="mb-1 flex justify-end">
            <button type="button" onClick={() => setOpenId(null)} aria-label="Close" className="text-ink-500 hover:text-ink-900 -mt-1 px-1 text-lg leading-none">
              ×
            </button>
          </div>
          {renderFound(openId)}
        </aside>
      )}

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

/**
 * Asking a colleague to contact a property, from the event's map (doc
 * §4.11): who does it and a note make a hotel contact task — the same one
 * sourcing makes, with its checklist. An open one is shown instead, with a link.
 */
function ContactTaskBox({ propertyId, eventId }: { propertyId: string; eventId: string }) {
  const utils = api.useUtils();
  const existing = api.task.hotelContactFor.useQuery({ propertyId, eventId });
  const people = api.user.list.useQuery();
  const me = api.user.me.useQuery();
  const event = api.event.byId.useQuery({ id: eventId });
  const [assigneeId, setAssigneeId] = useState("");
  const [note, setNote] = useState("");
  const create = api.task.createHotelContact.useMutation({
    onSuccess: () => {
      setNote("");
      void utils.task.invalidate();
    },
  });
  // Whoever sources the event's accommodation, by default; otherwise you.
  const fallback = event.data?.accommodationManagers[0]?.id ?? me.data?.id ?? "";
  const chosen = assigneeId || fallback;

  if (existing.isLoading) return null;
  const task = existing.data;
  return (
    <div className="border-ink-200/60 mt-5 rounded-lg border p-3">
      <PanelHeading>Contact task</PanelHeading>
      {task ? (
        <p className="text-ink-700 text-[13px] font-light">
          {task.assignees.length ? `With ${task.assignees.map((person) => person.name ?? person.email).join(", ")}` : "Nobody on it yet"}
          {" · "}
          <Link href={`/tasks/${task.id}`} className="text-brand-700 font-medium hover:underline">
            Open the task →
          </Link>
        </p>
      ) : (
        <div className="space-y-2">
          <select
            value={chosen}
            onChange={(e) => setAssigneeId(e.target.value)}
            aria-label="Who contacts it"
            className="border-ink-200 w-full rounded-lg border bg-white px-2.5 py-1.5 text-[13px] font-light"
          >
            {(people.data ?? []).map((person) => (
              <option key={person.id} value={person.id}>
                {person.name ?? person.email}
                {person.id === me.data?.id ? " (me)" : ""}
              </option>
            ))}
          </select>
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={3}
            placeholder="A note for them — what to ask, who to speak to"
            aria-label="Note"
            className="border-ink-200 focus:border-brand-400 w-full rounded-lg border bg-white px-2.5 py-1.5 text-[13px] font-light outline-none"
          />
          <button
            type="button"
            disabled={!chosen || create.isPending}
            onClick={() => create.mutate({ propertyId, eventId, assigneeId: chosen, note })}
            className="bg-brand-400 hover:bg-brand-500 w-full rounded-full px-3 py-1.5 text-[13px] font-medium text-white disabled:opacity-60"
          >
            {create.isPending ? "Creating…" : "Create contact task"}
          </button>
          {create.error && <p className="text-xs text-[#c03654]">{create.error.message}</p>}
        </div>
      )}
    </div>
  );
}
