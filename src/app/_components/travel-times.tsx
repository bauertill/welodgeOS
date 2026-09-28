"use client";

import type { PlaceCategory } from "generated/prisma";

import type { MapPlace } from "~/app/_components/scouting-map";
import { api } from "~/trpc/react";

/**
 * The colour a place of interest is drawn in, on the map and beside its name.
 * Places of interest are squares, not dots, so a venue is never mistaken for a
 * hotel at a glance. Colour separates one kind of place from another.
 */
export const placeColors: Record<PlaceCategory, string> = {
  VENUE: "#292929",
  TRAIN_STATION: "#1f6feb",
  AIRPORT: "#0d8f5d",
  OTHER: "#6b6b6b",
};

/** "23 min", "1 h 05". Anything under a minute is still a minute's walk away. */
export function formatDuration(seconds: number) {
  const minutes = Math.max(1, Math.round(seconds / 60));
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  return `${hours} h ${String(minutes % 60).padStart(2, "0")}`;
}

export const formatKm = (metres: number) =>
  `${(metres / 1000).toFixed(metres < 10_000 ? 1 : 0)} km`;


/**
 * How long it takes to get to each place of interest, by bike, car and public
 * transport (doc §3.8). Asked for only when a property is opened, and never
 * stored — Google's terms forbid keeping these.
 */
export function TravelTimes({
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

