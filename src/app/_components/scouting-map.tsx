"use client";

import "leaflet/dist/leaflet.css";

import L from "leaflet";
import { MapContainer, Marker, Popup, TileLayer, useMap } from "react-leaflet";
import { useEffect } from "react";
import type { ScoutingStatus } from "generated/prisma";

import { scoutingStatusLabels } from "~/lib/scouting";

export type MapPin = {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  status: ScoutingStatus;
  subtitle: string;
  href: string;
};

const pinColors: Record<ScoutingStatus, string> = {
  PROSPECT: "#8a8a8a",
  CONTACTED: "#614fc9",
  SHORTLISTED: "#ab6ce2",
  REJECTED: "#db4b68",
  CONTRACTED: "#12b878",
};

/**
 * Markers are drawn as inline HTML rather than image files — Leaflet's default
 * icons resolve to bundled assets that a Next build rewrites, and a coloured
 * dot carries the status anyway.
 */
const markerIcon = (status: ScoutingStatus, venue = false) =>
  L.divIcon({
    className: "",
    iconSize: venue ? [18, 18] : [14, 14],
    iconAnchor: venue ? [9, 9] : [7, 7],
    html: venue
      ? `<span style="display:block;width:18px;height:18px;border-radius:4px;background:#292929;border:3px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.4)"></span>`
      : `<span style="display:block;width:14px;height:14px;border-radius:50%;background:${pinColors[status]};border:2px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.35)"></span>`,
  });

/** Keeps every pin in frame, including when the filters change the set. */
function FitBounds({ points }: { points: [number, number][] }) {
  const map = useMap();

  useEffect(() => {
    if (points.length === 0) return;
    if (points.length === 1) {
      map.setView(points[0]!, 13);
      return;
    }
    map.fitBounds(L.latLngBounds(points), { padding: [40, 40] });
  }, [map, points]);

  return null;
}

export function ScoutingMap({
  pins,
  venue,
}: {
  pins: MapPin[];
  venue?: { name: string; latitude: number; longitude: number } | null;
}) {
  const points: [number, number][] = [
    ...pins.map((pin) => [pin.latitude, pin.longitude] as [number, number]),
    ...(venue ? [[venue.latitude, venue.longitude] as [number, number]] : []),
  ];

  return (
    <div className="border-ink-200/60 overflow-hidden rounded-xl border">
      <MapContainer
        center={points[0] ?? [46.8182, 8.2275]}
        zoom={points.length ? 12 : 6}
        scrollWheelZoom
        style={{ height: "32rem", width: "100%" }}
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />

        <FitBounds points={points} />

        {venue && (
          <Marker
            position={[venue.latitude, venue.longitude]}
            icon={markerIcon("PROSPECT", true)}
          >
            <Popup>
              <strong>{venue.name}</strong>
              <br />
              Event venue
            </Popup>
          </Marker>
        )}

        {pins.map((pin) => (
          <Marker
            key={pin.id}
            position={[pin.latitude, pin.longitude]}
            icon={markerIcon(pin.status)}
          >
            <Popup>
              <strong>{pin.name}</strong>
              <br />
              {pin.subtitle}
              <br />
              <span style={{ color: pinColors[pin.status] }}>
                {scoutingStatusLabels[pin.status]}
              </span>
              <br />
              <a href={pin.href}>Open →</a>
            </Popup>
          </Marker>
        ))}
      </MapContainer>
    </div>
  );
}
