import { z } from "zod";

import { env } from "~/env";
import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";

/**
 * How long it takes to get from a property to each of an event's places of
 * interest, by bike, car and public transport (doc §3.8).
 *
 * Two rules from the document shape everything here:
 *
 * - **Nothing is stored.** Every answer is fetched from Google when somebody
 *   looks. That is what "nothing derived is stored" requires, and also what
 *   Google's terms require, since they forbid keeping its travel times.
 * - **One property at a time.** These are asked for when a property is opened,
 *   not for every property on the map at once — a shortlist against every place
 *   would be hundreds of lookups, most of them never read.
 */

const ROUTE_MATRIX_URL =
  "https://routes.googleapis.com/distanceMatrix/v2:computeRouteMatrix";

/** The three ways of getting there the business asks about (doc §3.8). */
const MODES = ["BICYCLE", "DRIVE", "TRANSIT"] as const;
type Mode = (typeof MODES)[number];

export type Leg = { seconds: number; metres: number } | null;

export type TravelToPlace = {
  placeId: string;
  /** Null where Google has no answer — never zero, never a guess. */
  bike: Leg;
  car: Leg;
  transit: Leg;
};

type Coordinates = { latitude: number; longitude: number };

/**
 * Public transport needs a departure time: Google always answers for a
 * specific one, and asked for "now" at 11pm it answers with a night
 * timetable. The document settles this as "the next weekday at 10:00, local
 * time" — an ordinary daytime journey (doc §3.8).
 *
 * We have no time zone for a pair of coordinates, and fetching one would mean
 * another Google service for a number that only has to be roughly right. So
 * the offset is estimated from longitude — 15° per hour. That is wrong by an
 * hour or two wherever political time zones disagree with the sun, which does
 * not matter for "mid-morning on a weekday", and is far better than using UTC,
 * which would ask for a 3am timetable in Los Angeles.
 */
function nextWeekdayMorning(longitude: number): Date {
  const offsetHours = Math.round(longitude / 15);
  const offsetMs = offsetHours * 3_600_000;
  const now = Date.now();

  // Shifting by the offset puts the local wall clock into the UTC fields, so
  // the date and weekday below are the ones at the property, not in Greenwich.
  const local = new Date(now + offsetMs);

  for (let add = 0; add < 8; add += 1) {
    const localTen = Date.UTC(
      local.getUTCFullYear(),
      local.getUTCMonth(),
      local.getUTCDate() + add,
      10,
      0,
      0,
    );
    const weekday = new Date(localTen).getUTCDay();
    if (weekday === 0 || weekday === 6) continue;

    // Back out of the shift to get the real instant to ask Google about.
    const instant = localTen - offsetMs;
    // Google refuses a departure in the past; a few minutes' margin covers the
    // round trip.
    if (instant > now + 300_000) return new Date(instant);
  }

  // Unreachable in practice — eight days always contain a weekday morning.
  return new Date(now + 86_400_000);
}

const waypoint = (point: Coordinates) => ({
  waypoint: { location: { latLng: point } },
});

type MatrixElement = {
  originIndex?: number;
  destinationIndex?: number;
  duration?: string;
  distanceMeters?: number;
  condition?: string;
};

/**
 * One call per mode, covering every place at once. Routes API caps a transit
 * matrix at 100 elements; one origin against an event's places is nowhere
 * near that, but the cap is why places are not batched with properties.
 */
async function legsForMode(
  mode: Mode,
  from: Coordinates,
  destinations: Coordinates[],
  key: string,
): Promise<Leg[]> {
  const body: Record<string, unknown> = {
    origins: [waypoint(from)],
    destinations: destinations.map(waypoint),
    travelMode: mode,
  };

  if (mode === "DRIVE") {
    // A typical journey, not a rush-hour one (doc §3.8).
    body.routingPreference = "TRAFFIC_UNAWARE";
  }
  if (mode === "TRANSIT") {
    body.departureTime = nextWeekdayMorning(from.longitude).toISOString();
  }

  const response = await fetch(ROUTE_MATRIX_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": key,
      "X-Goog-FieldMask":
        "originIndex,destinationIndex,duration,distanceMeters,condition",
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    // A mode Google cannot answer for is "not available", not a broken page —
    // some cities have no transit data at all. The reason is logged so it is
    // not invisible to whoever maintains this.
    console.error(
      `[travel] Google refused the ${mode} matrix: ${response.status} ${await response
        .text()
        .catch(() => "")}`,
    );
    return destinations.map(() => null);
  }

  const elements = (await response.json()) as MatrixElement[];
  const legs: Leg[] = destinations.map(() => null);

  for (const element of elements) {
    const index = element.destinationIndex ?? 0;
    if (element.condition !== "ROUTE_EXISTS") continue;
    if (element.duration === undefined) continue;

    legs[index] = {
      seconds: Number.parseInt(element.duration.replace("s", ""), 10),
      metres: element.distanceMeters ?? 0,
    };
  }

  return legs;
}

export const travelRouter = createTRPCRouter({
  /**
   * Every place of interest on this event, with how long it takes to reach
   * each from this property. Places are read here rather than taken from the
   * caller, so the numbers always describe the event actually being looked at.
   */
  fromProperty: protectedProcedure
    .input(z.object({ propertyId: z.string(), eventId: z.string() }))
    .query(async ({ ctx, input }): Promise<TravelToPlace[]> => {
      const property = await ctx.db.property.findUniqueOrThrow({
        where: { id: input.propertyId },
        select: { latitude: true, longitude: true },
      });

      const places = await ctx.db.placeOfInterest.findMany({
        where: { eventId: input.eventId },
        select: { id: true, latitude: true, longitude: true },
        orderBy: [{ category: "asc" }, { name: "asc" }],
      });

      if (
        property.latitude === null ||
        property.longitude === null ||
        places.length === 0
      ) {
        return [];
      }

      const key = env.GOOGLE_MAPS_SERVER_KEY;
      if (!key) {
        // Without a key there are no travel times, and saying so beats an
        // error page — the rest of the panel is still worth reading.
        return places.map((place) => ({
          placeId: place.id,
          bike: null,
          car: null,
          transit: null,
        }));
      }

      const from = { latitude: property.latitude, longitude: property.longitude };
      const destinations = places.map((place) => ({
        latitude: place.latitude,
        longitude: place.longitude,
      }));

      const [bike, car, transit] = await Promise.all(
        MODES.map((mode) => legsForMode(mode, from, destinations, key)),
      );

      return places.map((place, index) => ({
        placeId: place.id,
        bike: bike?.[index] ?? null,
        car: car?.[index] ?? null,
        transit: transit?.[index] ?? null,
      }));
    }),
});
