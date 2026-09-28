"use client";

import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { Fragment, useMemo, useState } from "react";
import type { CategoryContractStatus, PropertyType } from "generated/prisma";

import { ScoutingActivityLog } from "~/app/_components/activity-log";
import { Button, Select } from "~/app/_components/form";
import type { MapPin, MapPlace } from "~/app/_components/scouting-map";
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
  categoryContractStatusLabels,
  categoryContractStatusOrder,
  cheapestCategory,
  nearestPlace,
  propertyTypeLabels,
  scoutingStatusHints,
  scoutingStatusLabels,
  scoutingStatusOrder,
  totalUnits,
  groupColours,
  type SelectableScoutingStatus,
} from "~/lib/scouting";
import { PendingLink } from "~/app/_components/pending-link";
import { PropertyEntryPanel } from "~/app/_components/property-entry-panel";
import { RoomCategoryTable } from "~/app/_components/room-categories";
import { GroupHeader, Initials, NewGroup } from "~/app/_components/property-groups";
import { api } from "~/trpc/react";

// Google Maps only exists in the browser, so the map never renders on the server.
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

export function ScoutingList({
  eventId,
  places,
  amenities,
}: {
  eventId: string;
  /** The event's places of interest (doc §3.7) — venues, airports, stations. */
  places: MapPlace[];
  amenities: { id: string; label: string }[];
}) {
  const router = useRouter();
  const [view, setView] = useState<"list" | "map">("list");
  const [status, setStatus] = useState<SelectableScoutingStatus | "">("");
  const [type, setType] = useState<PropertyType | "">("");
  const [amenityIds, setAmenityIds] = useState<string[]>([]);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

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
  const setCategoryStatusMutation = api.scouting.setCategoryContractStatus.useMutation({
    onSuccess: () => void entries.refetch(),
  });

  const toggleExpanded = (id: string) =>
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const rows = entries.data ?? [];

  // Groups on the Properties tab (doc §3.9): the event's own, top first, with
  // "No group" at the bottom for anything not sorted yet.
  const groups = api.scouting.groups.useQuery({ eventId });
  const setGroupMutation = api.scouting.setGroup.useMutation({
    onSuccess: () => void entries.refetch(),
  });
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());
  const [openEntry, setOpenEntry] = useState<string | null>(null);
  const sections = [
    ...(groups.data ?? []).map((group) => ({
      group,
      entries: rows.filter((entry) => entry.groupId === group.id),
    })),
    {
      group: null,
      entries: rows.filter(
        (entry) => !entry.groupId || !(groups.data ?? []).some((group) => group.id === entry.groupId),
      ),
    },
  ].filter((section) => section.group || section.entries.length > 0);

  // The sales team's at-a-glance position, per room category: whole rooms
  // genuinely free — bought and not blocked or sold — across the whole
  // window (doc §5.3). Only counts rooms actually brought into Inventory; a
  // category that is Contracted but not yet materialised has nothing to
  // report yet.
  const availability = api.reporting.availability.useQuery({ eventId });
  const availabilityByCategory = new Map(
    (availability.data ?? []).map((row) => [row.categoryId, row]),
  );

  const contractStatusOf = (
    entry: (typeof rows)[number],
    categoryId: string,
  ): CategoryContractStatus =>
    entry.categoryContracts.find((c) => c.categoryId === categoryId)
      ?.status ?? "IN_NEGOTIATION";

  // An event can have several venues, so "to venue" means the nearest one and
  // has to name it (doc §3.7).
  const venues = useMemo(
    () => places.filter((place) => place.category === "VENUE"),
    [places],
  );

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
          propertyId: entry.property.id,
          name: entry.property.name,
          latitude: entry.property.latitude!,
          longitude: entry.property.longitude!,
          status: entry.status,
          stars: entry.property.stars,
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

  const renderEntry = (entry: (typeof rows)[number]) => {
              const property = entry.property;
              const cheapest = cheapestCategory(property.categories);
              const units =
                totalUnits(property.categories) || property.totalRooms || 0;
              const nearest = nearestPlace(
                property.latitude !== null && property.longitude !== null
                  ? {
                      latitude: property.latitude,
                      longitude: property.longitude,
                    }
                  : null,
                venues,
              );

              const categoryOpen = expanded.has(entry.id);
              const hasCategories = property.categories.length > 0;
              const contractStatus = (categoryId: string): CategoryContractStatus =>
                contractStatusOf(entry, categoryId);

              // Rooms summed per status, not one line per category — a
              // property with a dozen room types would otherwise print a
              // dozen clauses instead of a status a rep can read at a glance.
              const roomsByStatus = new Map<CategoryContractStatus, number>();
              for (const category of property.categories) {
                const status = contractStatus(category.id);
                roomsByStatus.set(
                  status,
                  (roomsByStatus.get(status) ?? 0) + category.unitCount,
                );
              }
              // Contracted first, not funnel order — it's the fact that
              // matters most at a glance, before how far the rest have got.
              const statusSummary = [...categoryContractStatusOrder]
                .reverse()
                .filter((status) => roomsByStatus.get(status))
                .map(
                  (status) =>
                    `${roomsByStatus.get(status)} rooms ${categoryContractStatusLabels[status].toLowerCase()}`,
                );

              return (
                <Fragment key={entry.id}>
                <tr>
                  <Td>
                    <div className="flex min-w-52 items-start gap-1.5">
                      <button
                        type="button"
                        onClick={() => toggleExpanded(entry.id)}
                        disabled={!hasCategories}
                        aria-expanded={categoryOpen}
                        aria-label={
                          categoryOpen ? "Collapse room categories" : "Expand room categories"
                        }
                        className="text-ink-400 hover:text-ink-700 mt-0.5 shrink-0 disabled:opacity-0"
                      >
                        <svg
                          viewBox="0 0 16 16"
                          fill="none"
                          className={`h-3.5 w-3.5 transition-transform ${categoryOpen ? "rotate-90" : ""}`}
                        >
                          <path
                            d="M6 4l4 4-4 4"
                            stroke="currentColor"
                            strokeWidth="1.5"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          />
                        </svg>
                      </button>
                      <div>
                        <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                          <PendingLink
                            href={`/properties/${property.id}?back=${encodeURIComponent(`/events/${eventId}`)}`}
                            className="hover:text-brand-700 font-medium"
                          >
                            {property.name}
                          </PendingLink>
                          <button
                            type="button"
                            onClick={() => setOpenEntry(entry.id)}
                            className="border-ink-200 text-ink-500 hover:border-brand-400 hover:text-brand-700 rounded-full border px-2 py-0.5 text-[11px] font-light whitespace-nowrap transition-colors"
                            title="This event's terms, contracting details and contacts, without leaving the page"
                          >
                            Quick view
                          </button>
                        </span>
                        <span className="text-ink-500 block text-xs font-light">
                          {property.provider ? `${property.provider.name} · ` : ""}
                          {propertyTypeLabels[property.type]}
                          {property.stars ? ` · ${property.stars}-star` : ""}
                        </span>
                        {statusSummary.map((line) => (
                          <span
                            key={line}
                            className="text-ink-500 block text-xs font-light"
                          >
                            {line}
                          </span>
                        ))}
                      </div>
                    </div>
                  </Td>
                  <Td>
                    {entry.accountManager ? (
                      <span className="flex items-center gap-2 whitespace-nowrap">
                        <Initials person={entry.accountManager} />
                        <span className="text-[13px] font-light">
                          {(entry.accountManager.name ?? entry.accountManager.email ?? "").split(" ")[0]}
                        </span>
                      </span>
                    ) : (
                      <span className="text-ink-500">—</span>
                    )}
                  </Td>
                  <Td>
                    {property.area && <span className="block">{property.area}</span>}
                    <span className={property.area ? "text-ink-500 text-xs font-light" : ""}>
                      {[property.city, property.country].filter(Boolean).join(", ") || (property.area ? "" : "—")}
                    </span>
                  </Td>
                  <Td>{units || "—"}</Td>
                  <Td>
                    {cheapest
                      ? formatMoney(
                          cheapest.indicativePriceMinCents!,
                          cheapest.currency,
                        )
                      : "—"}
                  </Td>
                  {venues.length > 0 && (
                    <Td>
                      {nearest === null ? (
                        "—"
                      ) : (
                        <>
                          <span className="whitespace-nowrap">
                            {nearest.km.toFixed(1)} km
                          </span>
                          {venues.length > 1 && (
                            <span className="text-ink-500 block text-xs font-light">
                              {nearest.place.name}
                            </span>
                          )}
                        </>
                      )}
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
                          status: e.target.value as SelectableScoutingStatus,
                        })
                      }
                      className="w-36 min-w-36 py-1.5 text-[13px]"
                    >
                      {scoutingStatusOrder.map((option) => (
                        <option key={option} value={option}>
                          {scoutingStatusLabels[option]}
                        </option>
                      ))}
                    </Select>
                  </Td>
                  <Td>
                    <Select
                      value={entry.groupId ?? ""}
                      aria-label="Group"
                      onChange={(e) => setGroupMutation.mutate({ id: entry.id, groupId: e.target.value || null })}
                      className="w-40 min-w-40 py-1.5 text-[13px]"
                    >
                      <option value="">No group</option>
                      {(groups.data ?? []).map((group) => (
                        <option key={group.id} value={group.id}>
                          {group.name}
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

                {categoryOpen && hasCategories && (
                  <tr>
                    <Td colSpan={venues.length > 0 ? 10 : 9}>
                      <RoomCategoryTable
                        scoutingEntryId={entry.id}
                        propertyId={property.id}
                        eventId={eventId}
                        categories={property.categories}
                        contracts={entry.categoryContracts}
                        available={(categoryId) => {
                          const position = availabilityByCategory.get(categoryId);
                          return position && position.slots > 0
                            ? `${position.genuinelyFree} available`
                            : "Not in inventory yet";
                        }}
                        onStatusChange={(categoryId, status) =>
                          setCategoryStatusMutation.mutate({
                            scoutingEntryId: entry.id,
                            categoryId,
                            status,
                          })
                        }
                      />
                      <div className="border-ink-200/60 mt-3 ml-5 border-t pt-3">
                        <ScoutingActivityLog scoutingEntryId={entry.id} />
                      </div>
                    </Td>
                  </tr>
                )}
                </Fragment>
              );
  };

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
          onChange={(e) => setStatus(e.target.value as SelectableScoutingStatus | "")}
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
          <ScoutingMap
            pins={pins}
            places={places}
            availability={availability.data ?? []}
            eventId={eventId}
          />
          {withoutCoordinates > 0 && (
            <p className="text-ink-500 text-xs font-light">
              {withoutCoordinates}{" "}
              {withoutCoordinates === 1 ? "property is" : "properties are"} not
              shown — no coordinates recorded yet.
            </p>
          )}
        </>
      ) : (
        <div className="space-y-6">
          {sections.map(({ group, entries: sectionRows }) => {
            const key = group?.id ?? "none";
            const collapsed = collapsedGroups.has(key);
            return (
              <section key={key}>
                <GroupHeader
                  group={group}
                  entries={sectionRows}
                  collapsed={collapsed}
                  onToggle={() =>
                    setCollapsedGroups((current) => {
                      const next = new Set(current);
                      if (next.has(key)) next.delete(key);
                      else next.add(key);
                      return next;
                    })
                  }
                  isFirst={group ? groups.data?.[0]?.id === group.id : false}
                  isLast={group ? groups.data?.at(-1)?.id === group.id : false}
                />
                {!collapsed && sectionRows.length > 0 && (
                  <div
                    className="border-l-4 pl-0"
                    style={{ borderColor: group ? groupColours[group.colour].hex : "#d0d0d0" }}
                  >
            <Table>
              <thead>
                <tr>
                  <Th>Property</Th>
                  <Th>Account manager</Th>
                  <Th>Location</Th>
                  <Th>Rooms</Th>
                  <Th>From</Th>
                  {venues.length > 0 && <Th>To venue</Th>}
                  <Th>Amenities</Th>
                  <Th>Status</Th>
                  <Th>Group</Th>
                  <Th>{""}</Th>
                </tr>
              </thead>
                      <tbody>{sectionRows.map(renderEntry)}</tbody>
                    </Table>
                  </div>
                )}
                {!collapsed && sectionRows.length === 0 && (
                  <p className="text-ink-500 ml-5 text-xs font-light">
                    Nothing in this group yet — choose it in a property&apos;s Group column.
                  </p>
                )}
              </section>
            );
          })}
          <NewGroup eventId={eventId} />
        </div>
      )}

      {openEntry && <PropertyEntryPanel entryId={openEntry} onClose={() => setOpenEntry(null)} />}

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
