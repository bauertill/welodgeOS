import type { PropertyType } from "generated/prisma";

import { distanceKm } from "~/lib/scouting";

/**
 * How well a property we already have fits a sales request (doc §4.11) — told
 * by four plain checks, each said in words, so a suggestion can be judged at
 * a glance: how near it is to the client's places, whether it is the kind
 * they want (hotel rooms or apartments), whether it has the units, and
 * whether its event rate is within their budget. A check that cannot be
 * made — no coordinates, no price, a different currency — is said, not guessed.
 */

export const NEAR_KM = 3;
export const WITHIN_KM = 8;

export type Target = { label: string; latitude: number; longitude: number };
export type Wanted = {
  /** The most units on any one line — what has to be there at once. */
  units: number;
  apartments: boolean;
  hotelRooms: boolean;
  budgetCents: number | null;
  budgetCurrency: string | null;
  /** The budget compared only when it is per room (or unit) per night. */
  budgetPerNight: boolean;
};
export type Candidate = {
  type: PropertyType;
  latitude: number;
  longitude: number;
  /**
   * Its categories, each with its price for a night: the event rate (agreed,
   * or quoted for the event's dates) — or, for a property scouted before the
   * event rate, its old indicative price, said so.
   */
  categories: { unitCount: number; bedrooms: number | null; priceCents: number | null; currency: string; indicative?: boolean }[];
  stated: number | null;
};

export type Check = { ok: boolean | null; text: string };

export function fit(candidate: Candidate, targets: Target[], wanted: Wanted) {
  const checks: Check[] = [];

  // Near: the closest of the client's places.
  const nearest = targets
    .map((target) => ({ target, km: distanceKm(candidate, target) }))
    .sort((a, b) => a.km - b.km)[0];
  if (nearest) {
    checks.push({
      ok: nearest.km <= WITHIN_KM,
      text: `${nearest.km < 1 ? `${Math.round(nearest.km * 1000)} m` : `${nearest.km.toFixed(1)} km`} from ${nearest.target.label}`,
    });
  }

  // The kind: hotel rooms, apartments, or an aparthotel for either.
  const kindOk =
    candidate.type === "APARTHOTEL" ||
    (wanted.apartments && candidate.type === "APARTMENT") ||
    (wanted.hotelRooms && candidate.type === "HOTEL") ||
    (!wanted.apartments && !wanted.hotelRooms);
  checks.push({
    ok: kindOk,
    text: candidate.type === "HOTEL" ? "Hotel" : candidate.type === "APARTMENT" ? "Apartments" : "Aparthotel",
  });

  // The units: all its categories together, or its stated total.
  const units = candidate.categories.reduce((sum, category) => sum + category.unitCount, 0) || candidate.stated || 0;
  if (wanted.units > 0) {
    checks.push(units ? { ok: units >= wanted.units, text: `${units} units (${wanted.units} wanted)` } : { ok: null, text: "Units not known" });
  }

  // The price: its lowest event rate, against a per-night budget in the same currency.
  if (wanted.budgetCents !== null && wanted.budgetPerNight) {
    const priced = candidate.categories.filter((category) => category.priceCents !== null && category.currency === wanted.budgetCurrency);
    const cheapest = priced.length ? priced.reduce((low, category) => (category.priceCents! < low.priceCents! ? category : low)) : null;
    checks.push(
      cheapest === null
        ? { ok: null, text: "No quote for the event to compare" }
        : {
            ok: cheapest.priceCents! <= wanted.budgetCents,
            text: `From ${(cheapest.priceCents! / 100).toFixed(0)} ${wanted.budgetCurrency} a night${cheapest.indicative ? " (indicative)" : ""}`,
          },
    );
  }

  const failed = checks.filter((check) => check.ok === false).length;
  const unknown = checks.filter((check) => check.ok === null).length;
  // "Fits" only when every check could be made and passed.
  const verdict: "good" | "unclear" | "partly" | "poor" = failed === 0 ? (unknown === 0 ? "good" : "unclear") : failed === 1 ? "partly" : "poor";
  return { verdict, checks, km: nearest?.km ?? null };
}
