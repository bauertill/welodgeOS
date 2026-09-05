"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import type { PropertyType, ScoutingStatus } from "generated/prisma";

import { Button, Select } from "~/app/_components/form";
import type { MapPin } from "~/app/_components/scouting-map";
import {
  EmptyState,
  Pill,
  ScoutingStatusBadge,
  Table,
  Td,
  Th,
} from "~/app/_components/ui";
import { formatMoney } from "~/lib/format";
import {
  cheapestCategory,
  distanceKm,
  propertyTypeLabels,
  scoutingStatusHints,
  scoutingStatusLabels,
  scoutingStatusOrder,
  totalUnits,
} from "~/lib/scouting";
import { api } from "~/trpc/react";

// Leaflet touches `window` on import, so the map only ever loads in the browser.
const ScoutingMap = dynamic(
  () => import("~/app/_components/scouting-map").then((m) => m.ScoutingMap),
  {
    ssr: false,
    loading: () => (
      <div className="border-ink-200/60 text-ink-500 flex h-[32rem] items-center justify-center rounded-xl border bg-white text-sm font-light">
        Loading map…
      </div>
    ),
  },
);

type Venue = { name: string; latitude: number; longitude: number } | null;

export function ScoutingList({
  eventId,
  venue,
  amenities,
}: {
  eventId: string;
  venue: Venue;
  amenities: { id: string; label: string }[];
}) {
  const router = useRouter();
  const [view, setView] = useState<"list" | "map">("list");
  const [status, setStatus] = useState<ScoutingStatus | "">("");
  const [type, setType] = useState<PropertyType | "">("");
  const [amenityIds, setAmenityIds] = useState<string[]>([]);

  const entries = api.scouting.listForEvent.useQuery({
    eventId,
    status: status || undefined,
    type: type || undefined,
    amenityIds,
  });

  const setStatusMutation = api.scouting.setStatus.useMutation({
    onSuccess: () => void entries.refetch(),
  });
  const removeMutation = api.scouting.remove.useMutation({
    onSuccess: () => {
      void entries.refetch();
      router.refresh();
    },
  });

  const rows = entries.data ?? [];

  const pins: MapPin[] = useMemo(
    () =>
      rows
        .filter(
          (entry) =>
            entry.property.latitude !== null &&
            entry.property.longitude !== null,
        )
        .map((entry) => ({
          id: entry.id,
          name: entry.property.name,
          latitude: entry.property.latitude!,
          longitude: entry.property.longitude!,
          status: entry.status,
          subtitle: [
            propertyTypeLabels[entry.property.type],
            entry.property.city,
          ]
            .filter(Boolean)
            .join(" · "),
          href: `/properties/${entry.property.id}`,
        })),
    [rows],
  );

  const withoutCoordinates = rows.length - pins.length;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="border-ink-200 flex rounded-full border bg-white p-1">
          {(["list", "map"] as const).map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => setView(option)}
              className={`rounded-full px-4 py-1.5 text-[13px] font-light transition-colors ${
                view === option
                  ? "bg-brand-400 text-white"
                  : "text-ink-500 hover:text-ink-900"
              }`}
            >
              {option === "list" ? "List" : "Map"}
            </button>
          ))}
        </div>

        <Select
          value={status}
          onChange={(e) => setStatus(e.target.value as ScoutingStatus | "")}
          className="w-auto"
        >
          <option value="">Any status</option>
          {scoutingStatusOrder.map((option) => (
            <option key={option} value={option}>
              {scoutingStatusLabels[option]}
            </option>
          ))}
        </Select>

        <Select
          value={type}
          onChange={(e) => setType(e.target.value as PropertyType | "")}
          className="w-auto"
        >
          <option value="">Every type</option>
          <option value="HOTEL">Hotels only</option>
          <option value="APARTMENT">Apartments only</option>
          <option value="APARTHOTEL">Aparthotels only</option>
        </Select>

        <span className="text-ink-500 ml-auto text-[13px] font-light">
          {entries.isLoading
            ? "Loading…"
            : `${rows.length} ${rows.length === 1 ? "property" : "properties"}`}
        </span>
      </div>

      {amenities.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-ink-500 text-[11px] font-medium tracking-wider uppercase">
            Must have
          </span>
          {amenities.map((amenity) => {
            const active = amenityIds.includes(amenity.id);
            return (
              <button
                key={amenity.id}
                type="button"
                onClick={() =>
                  setAmenityIds((current) =>
                    active
                      ? current.filter((id) => id !== amenity.id)
                      : [...current, amenity.id],
                  )
                }
                className={`rounded-full px-3 py-1 text-[11px] font-light transition-colors ${
                  active
                    ? "bg-brand-700 text-white"
                    : "border-ink-200 text-ink-500 hover:border-brand-400 border bg-white"
                }`}
              >
                {amenity.label}
              </button>
            );
          })}
          {amenityIds.length > 0 && (
            <button
              type="button"
              onClick={() => setAmenityIds([])}
              className="text-brand-700 text-[11px] font-light underline"
            >
              Clear
            </button>
          )}
        </div>
      )}

      {rows.length === 0 && !entries.isLoading ? (
        <EmptyState
          title="Nothing on this list yet"
          description="Add properties you could contract for this event. Nothing here commits us to anything — it is research until Phase 2 picks it up."
        />
      ) : view === "map" ? (
        <>
          <ScoutingMap pins={pins} venue={venue} />
          {withoutCoordinates > 0 && (
            <p className="text-ink-500 text-xs font-light">
              {withoutCoordinates}{" "}
              {withoutCoordinates === 1 ? "property is" : "properties are"} not
              shown — no coordinates recorded yet.
            </p>
          )}
        </>
      ) : (
        <Table>
          <thead>
            <tr>
              <Th>Property</Th>
              <Th>Location</Th>
              <Th>Rooms</Th>
              <Th>From</Th>
              {venue && <Th>To venue</Th>}
              <Th>Amenities</Th>
              <Th>Status</Th>
              <Th>{""}</Th>
            </tr>
          </thead>
          <tbody>
            {rows.map((entry) => {
              const property = entry.property;
              const cheapest = cheapestCategory(property.categories);
              const units =
                totalUnits(property.categories) || property.totalRooms || 0;
              const distance =
                venue &&
                property.latitude !== null &&
                property.longitude !== null
                  ? distanceKm(
                      {
                        latitude: property.latitude,
                        longitude: property.longitude,
                      },
                      venue,
                    )
                  : null;

              return (
                <tr key={entry.id}>
                  <Td>
                    <Link
                      href={`/properties/${property.id}`}
                      className="hover:text-brand-700 font-medium"
                    >
                      {property.name}
                    </Link>
                    <span className="text-ink-500 block text-xs font-light">
                      {propertyTypeLabels[property.type]}
                      {property.stars ? ` · ${property.stars}-star` : ""}
                    </span>
                  </Td>
                  <Td>
                    {[property.city, property.country]
                      .filter(Boolean)
                      .join(", ") || "—"}
                  </Td>
                  <Td>{units || "—"}</Td>
                  <Td>
                    {cheapest?.indicativePriceCents
                      ? formatMoney(
                          cheapest.indicativePriceCents,
                          cheapest.currency,
                        )
                      : "—"}
                  </Td>
                  {venue && (
                    <Td>
                      {distance === null ? "—" : `${distance.toFixed(1)} km`}
                    </Td>
                  )}
                  <Td>
                    <div className="flex max-w-56 flex-wrap gap-1">
                      {property.amenities.slice(0, 3).map((amenity) => (
                        <Pill key={amenity.id}>{amenity.label}</Pill>
                      ))}
                      {property.amenities.length > 3 && (
                        <Pill>+{property.amenities.length - 3}</Pill>
                      )}
                      {property.amenities.length === 0 && "—"}
                    </div>
                  </Td>
                  <Td>
                    <Select
                      value={entry.status}
                      title={scoutingStatusHints[entry.status]}
                      onChange={(e) =>
                        setStatusMutation.mutate({
                          id: entry.id,
                          status: e.target.value as ScoutingStatus,
                        })
                      }
                      className="w-36 py-1.5 text-[13px]"
                    >
                      {scoutingStatusOrder.map((option) => (
                        <option key={option} value={option}>
                          {scoutingStatusLabels[option]}
                        </option>
                      ))}
                    </Select>
                  </Td>
                  <Td>
                    <Button
                      type="button"
                      variant="ghost"
                      className="px-2 py-1"
                      onClick={() => removeMutation.mutate({ id: entry.id })}
                      disabled={removeMutation.isPending}
                    >
                      Remove
                    </Button>
                  </Td>
                </tr>
              );
            })}
          </tbody>
        </Table>
      )}

      <p className="text-ink-500 text-xs font-light">
        Removing a property takes it off this event&apos;s list only — the
        property itself stays in the library for other events.
      </p>
    </div>
  );
}

/** Kept beside the list so status wording lives in one file. */
export function ScoutingStatusKey() {
  return (
    <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
      {scoutingStatusOrder.map((status) => (
        <div key={status} className="flex items-start gap-2">
          <ScoutingStatusBadge status={status} />
          <span className="text-ink-500 text-xs font-light">
            {scoutingStatusHints[status]}
          </span>
        </div>
      ))}
    </div>
  );
}
