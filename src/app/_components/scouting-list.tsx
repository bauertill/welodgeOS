"use client";

import Link from "next/link";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { Fragment, useMemo, useState } from "react";

import { useRemembered } from "~/lib/remembered";
import { formatDate, formatMoney } from "~/lib/format";
import { verdictLabels, verdictStyles } from "~/lib/site-visits";
import { roomTypeGroups, roomTypeOf } from "~/lib/sales";
import type { CategoryContractStatus, PropertyType, ScoutingDetail, ScoutingStatus } from "generated/prisma";

import { ScoutingActivityLog } from "~/app/_components/activity-log";
import { Button, Select } from "~/app/_components/form";
import type { MapLayer, MapPin, MapPlace } from "~/app/_components/scouting-map";
import {
  EmptyState,
  ScoutingStatusBadge,
  Table,
  Td,
  Th,
} from "~/app/_components/ui";
import {
  categoryContractStatusLabels,
  categoryContractStatusOrder,
  isHotelLike,
  measuredPlaces,
  nearestPlace,
  propertyTypeLabels,
  propertyTypeOrder,
  scoutingDetailLabels,
  scoutingDetailOrder,
  scoutingStatusColours,
  scoutingStatusHints,
  scoutingStatusLabels,
  scoutingStatusOrder,
  totalUnits,
} from "~/lib/scouting";
import { PendingLink } from "~/app/_components/pending-link";
import { PropertyEntryPanel } from "~/app/_components/property-entry-panel";
import { RoomCategoryTable } from "~/app/_components/room-categories";
import { contractedByContract } from "~/lib/stages";
import { api } from "~/trpc/react";

// Google Maps only exists in the browser, so the map never renders on the server.
const NearbySearch = dynamic(
  () => import("~/app/_components/nearby-search").then((m) => m.NearbySearch),
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
  layers = [],
}: {
  eventId: string;
  /** The event's places of interest (doc §3.7) — venues, airports, stations. */
  places: MapPlace[];
  /** Its map layers, to show or hide on the map (doc §3.7). */
  layers?: MapLayer[];
}) {
  const router = useRouter();
  const [view, setView] = useState<"list" | "map">("list");
  // Filters stay as set until reset, per event (the team, 2026-11-12).
  const [types, setTypes] = useRemembered<PropertyType[]>(`scouting:${eventId}:types`, []);
  const [roomType, setRoomType] = useRemembered(`scouting:${eventId}:roomKind`, "");
  const [area, setArea] = useRemembered(`scouting:${eventId}:area`, "");
  const [maxRate, setMaxRate] = useRemembered(`scouting:${eventId}:maxRate`, "");
  const [search, setSearch] = useRemembered(`scouting:${eventId}:search`, "");
  /** Ticked rows, to move several into a group at once (doc §3.9). */
  const [selected, setSelected] = useState<Set<string>>(new Set());
  /** The rows being dragged, and the group they hover over. */
  const [dragging, setDragging] = useState<string[] | null>(null);
  const [dropOn, setDropOn] = useState<ScoutingStatus | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [providerId, setProviderId] = useRemembered(`scouting:${eventId}:provider`, "");
  const providers = api.provider.list.useQuery();
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [hasQuotations, setHasQuotations] = useRemembered(`scouting:${eventId}:quoted`, false);

  const entries = api.scouting.listForEvent.useQuery({
    eventId,
    types,
    amenityIds: [],
    providerId: providerId || undefined,
    hasQuotations,
  });

  // What came through from a quotation when something was marked Contracted (doc §3.9).
  const sayCarried = (result: { carried: string[]; undecided: string[] }) => {
    const parts = [
      result.carried.length ? `Rates carried from the quotation: ${result.carried.join("; ")}.` : null,
      result.undecided.length
        ? `${result.undecided.join(", ")}: several quotations, none accepted — accept one on the property's page and its rates come through.`
        : null,
    ].filter(Boolean);
    if (parts.length) setNotice(parts.join(" "));
  };
  const setStatusMutation = api.scouting.setStatus.useMutation({
    onSuccess: (result) => {
      setSelected(new Set());
      sayCarried(result);
      void entries.refetch();
    },
  });
  const setDetailMutation = api.scouting.setDetail.useMutation({
    onSuccess: () => void entries.refetch(),
  });
  const removeMutation = api.scouting.remove.useMutation({
    onSuccess: () => {
      void entries.refetch();
      router.refresh();
    },
  });
  const utils = api.useUtils();
  const setCategoryStatusMutation = api.scouting.setCategoryContractStatus.useMutation({
    onSuccess: (result) => {
      sayCarried(result);
      void entries.refetch();
      void utils.reporting.availability.invalidate();
      void utils.inventory.invalidate();
    },
  });

  const toggleExpanded = (id: string) =>
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const allRows = entries.data ?? [];
  const areaOf = (property: { area: string | null; city: string | null }) => property.area ?? property.city ?? "";
  // What the narrowing filters offer, from the properties on this list (doc §3.9).
  const areas = useMemo(
    () => [...new Set(allRows.map((entry) => areaOf(entry.property)).filter(Boolean))].sort((a, b) => a.localeCompare(b)),
    [allRows],
  );
  // The few room types a client asks for (doc §4.11), each hotel's own names read into them.
  const roomWords = roomType;
  const ceiling = Number(maxRate.replace(",", "."));
  // Free text (the owner, 2026-11-17): words found in the name, chain, area, town or address.
  const fold = (text: string) => text.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  const searchWords = fold(search).split(/\s+/).filter(Boolean);
  const rows = allRows.filter((entry) => {
    if (searchWords.length) {
      const haystack = fold(
        [entry.property.name, entry.property.provider?.name, entry.property.area, entry.property.city, entry.property.address].filter(Boolean).join(" "),
      );
      if (!searchWords.every((word) => haystack.includes(word))) return false;
    }
    if (area && areaOf(entry.property) !== area) return false;
    const matching = roomWords ? entry.property.categories.filter((category) => roomTypeOf(category) === roomWords) : null;
    if (matching && matching.length === 0) return false;
    if (maxRate.trim() && Number.isFinite(ceiling)) {
      // A night at or under the price — for the room type chosen, when one is.
      const ids = matching ? new Set(matching.map((category) => category.id)) : null;
      const cheapEnough = entry.rates.some((rate) => (!ids || ids.has(rate.categoryId)) && rate.cents <= ceiling * 100);
      if (!cheapEnough) return false;
    }
    return true;
  });
  const narrowed = Boolean(searchWords.length || area || roomWords || maxRate.trim());
  const filtered = narrowed || types.length > 0 || providerId !== "" || hasQuotations;
  const lowestRate = (entry: (typeof allRows)[number]) =>
    entry.rates.length ? entry.rates.reduce((low, rate) => (rate.cents < low.cents ? rate : low)) : null;

  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set(["group-REJECTED"]));

  /**
   * Into a group, by drag or "Move to". One held at Contracted by a contract
   * stays there — saying so, rather than moving and still showing it there.
   */
  const moveTo = (ids: string[], group: ScoutingStatus) => {
    const chosen = rows.filter((entry) => ids.includes(entry.id));
    const held = group === "CONTRACTED" ? [] : chosen.filter((entry) => contractedByContract(entry));
    const moving = chosen.filter((entry) => !held.includes(entry) && entry.group !== group);
    setNotice(
      held.length
        ? `${held.map((entry) => entry.property.name).join(", ")} ${held.length === 1 ? "stays" : "stay"} in Contracted — ${held.length === 1 ? "it has" : "they have"} a contract or contracted rooms on this event.`
        : null,
    );
    if (moving.length) setStatusMutation.mutate({ ids: moving.map((entry) => entry.id), status: group });
    else setSelected(new Set());
  };
  const toggleSelected = (ids: string[], on: boolean) =>
    setSelected((current) => {
      const next = new Set(current);
      for (const id of ids) {
        if (on) next.add(id);
        else next.delete(id);
      }
      return next;
    });
  const toggleGroup = (key: string) =>
    setCollapsedGroups((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  const [openEntry, setOpenEntry] = useState<string | null>(null);
  const [historyOpen, setHistoryOpen] = useState<Set<string>>(new Set());


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
      ?.status ?? "NOT_STARTED";

  // An event can have several venues, so "to venue" means the nearest one and
  // has to name it (doc §3.7).
  const venues = useMemo(
    () => measuredPlaces(places),
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
          status: entry.group,
          stars: entry.property.stars,
          type: entry.property.type,
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

  const columns = venues.length > 0 ? 9 : 8;

  // One group's table.
  const renderTable = (sectionRows: typeof rows, colour: string) => {
    const allTicked = sectionRows.length > 0 && sectionRows.every((entry) => selected.has(entry.id));
    return (
      <div className="border-l-4 pl-0" style={{ borderColor: colour }}>
        <Table>
          <thead>
            <tr>
              <Th className="w-8 pr-0">
                <input
                  type="checkbox"
                  aria-label="Tick every property in this group"
                  checked={allTicked}
                  onChange={(e) => toggleSelected(sectionRows.map((entry) => entry.id), e.target.checked)}
                  className="accent-brand-400 h-4 w-4 align-middle"
                />
              </Th>
              <Th>Property</Th>
              <Th>Status</Th>
              <Th>Last update</Th>
              <Th>Location</Th>
              <Th>Type</Th>
              <Th>Rooms</Th>
              {venues.length > 0 && <Th>To venue</Th>}
              <Th>{""}</Th>
            </tr>
          </thead>
          <tbody>{sectionRows.map((entry) => renderEntry(entry))}</tbody>
        </Table>
      </div>
    );
  };

  const renderEntry = (entry: (typeof rows)[number]) => {
              const property = entry.property;
              // The property's own total is the basis for judging capacity; the
              // registered room types only stand in when no total is known.
              const units = property.totalRooms || totalUnits(property.categories) || 0;
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
                // Rooms nothing has started on are not mentioned at all.
                .filter((status) => status !== "NOT_STARTED" && roomsByStatus.get(status))
                .map(
                  (status) =>
                    `${roomsByStatus.get(status)} rooms ${categoryContractStatusLabels[status].toLowerCase()}`,
                );
              const ticked = selected.has(entry.id);

              return (
                <Fragment key={entry.id}>
                <tr
                  draggable
                  onDragStart={(e) => {
                    const ids = ticked ? [...selected] : [entry.id];
                    setDragging(ids);
                    e.dataTransfer.effectAllowed = "move";
                    e.dataTransfer.setData("text/plain", ids.join(","));
                  }}
                  onDragEnd={() => {
                    setDragging(null);
                    setDropOn(null);
                  }}
                  className={`${ticked ? "bg-brand-50/60" : ""} ${dragging?.includes(entry.id) ? "opacity-50" : ""}`}
                >
                  <td className="border-ink-200/40 w-8 cursor-grab border-b py-3.5 pr-0 pl-5 align-top" title="Drag to another group">
                    <input
                      type="checkbox"
                      aria-label={`Tick ${property.name}`}
                      checked={ticked}
                      onChange={(e) => toggleSelected([entry.id], e.target.checked)}
                      className="accent-brand-400 mt-0.5 h-4 w-4"
                    />
                  </td>
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
                            title="Its room breakdown, quotations, this event's terms, contracting details and contacts, without leaving the page"
                          >
                            Quick view
                          </button>
                          {entry.siteVisit?.verdict && (
                            <span title={`Site visit on ${formatDate(entry.siteVisit.visit.visitedOn)}: ${entry.siteVisit.verdictNote ?? verdictLabels[entry.siteVisit.verdict]}`}>
                              <PendingLink
                                href={`/site-visits/${entry.siteVisit.visit.id}`}
                                className={`rounded-full px-2 py-0.5 text-[10px] font-semibold tracking-wide whitespace-nowrap uppercase ${verdictStyles[entry.siteVisit.verdict]}`}
                              >
                                {verdictLabels[entry.siteVisit.verdict]}
                              </PendingLink>
                            </span>
                          )}
                        </span>
                        {(property.provider ?? property.videoUrl) && (
                          <span className="text-ink-500 block text-xs font-light">
                            {property.provider && (
                              <PendingLink
                                href={`/providers/${property.provider.id}?back=${encodeURIComponent(`/events/${eventId}`)}`}
                                className="hover:text-brand-700 hover:underline"
                              >
                                {property.provider.name}
                              </PendingLink>
                            )}
                            {property.provider && property.videoUrl && " · "}
                            {property.videoUrl && <VideoLink url={property.videoUrl} />}
                          </span>
                        )}
                        {entry.quotations.length > 0 && (
                          <PendingLink
                            href={`/properties/${property.id}?back=${encodeURIComponent(`/events/${eventId}`)}#quotations`}
                            className="text-brand-700 block text-xs font-light hover:underline"
                          >
                            {entry.quotations.length} {entry.quotations.length === 1 ? "quotation" : "quotations"}
                            {entry.quotations.some((quotation) => quotation.status === "ACCEPTED") && " · one accepted"}
                          </PendingLink>
                        )}
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
                    {/* Set by hand, or else what the system works out (doc §3.9). */}
                    <Select
                      value={entry.detail ?? ""}
                      title={entry.detail ? "Set by hand — choose the first line to go back to what the system works out" : "Worked out from contact tasks and quotations; the others are set by hand"}
                      onChange={(e) =>
                        setDetailMutation.mutate({ id: entry.id, detail: (e.target.value || null) as ScoutingDetail | null })
                      }
                      className={`w-48 min-w-48 py-1.5 text-[13px] ${entry.detail ? "" : "text-ink-500"}`}
                    >
                      <option value="">{entry.autoDetail ? `${scoutingDetailLabels[entry.autoDetail]} · auto` : "—"}</option>
                      {scoutingDetailOrder.map((option) => (
                        <option key={option} value={option}>
                          {scoutingDetailLabels[option]}
                        </option>
                      ))}
                    </Select>
                  </Td>
                  <Td>
                    <span className="whitespace-nowrap" title={entry.lastUpdate.toLocaleString("en-GB")}>
                      {shortDate(entry.lastUpdate)}
                    </span>
                  </Td>
                  <Td>
                    {/* An event is in one country, so the country is left out
                        here: the area, then the town (doc §3.9). */}
                    {property.area && <span className="block">{property.area}</span>}
                    {property.city && property.city !== property.area && (
                      <span className={property.area ? "text-ink-500 text-xs font-light" : ""}>{property.city}</span>
                    )}
                    {!property.area && !property.city && "—"}
                  </Td>
                  <Td>
                    <span className="whitespace-nowrap">{propertyTypeLabels[property.type]}</span>
                    {property.stars ? <span className="text-ink-500 block text-xs font-light whitespace-nowrap">{property.stars}-star</span> : null}
                  </Td>
                  <Td>
                    {units || "—"}
                    {(() => {
                      const low = lowestRate(entry);
                      return low ? (
                        <span className="text-ink-500 block text-xs font-light whitespace-nowrap" title="The lowest rate per night quoted or agreed">
                          from {formatMoney(low.cents, low.currency)}
                        </span>
                      ) : null;
                    })()}
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
                    <Td colSpan={columns}>
                      <RoomCategoryTable
                        scoutingEntryId={entry.id}
                        propertyId={property.id}
                        eventId={eventId}
                        categories={property.categories}
                        contracts={entry.categoryContracts}
                        hotel={isHotelLike(property.type)}
                        available={(categoryId) => {
                          const position = availabilityByCategory.get(categoryId);
                          return position && position.slots > 0
                            ? `${position.genuinelyFree} available`
                            : "Nothing bought yet";
                        }}
                        onStatusChange={(categoryId, status) =>
                          setCategoryStatusMutation.mutate({
                            scoutingEntryId: entry.id,
                            categoryId,
                            status,
                          })
                        }
                      />
                      {/* The history only grows, so it is behind a button rather
                          than always open under the room categories. */}
                      <div className="border-ink-200/60 mt-3 ml-5 border-t pt-3">
                        <button
                          type="button"
                          onClick={() =>
                            setHistoryOpen((current) => {
                              const next = new Set(current);
                              if (next.has(entry.id)) next.delete(entry.id);
                              else next.add(entry.id);
                              return next;
                            })
                          }
                          aria-expanded={historyOpen.has(entry.id)}
                          className="text-brand-700 text-[13px] font-light hover:underline"
                        >
                          {historyOpen.has(entry.id) ? "Hide history" : "View history"}
                        </button>
                        {historyOpen.has(entry.id) && (
                          <div className="mt-3">
                            <ScoutingActivityLog scoutingEntryId={entry.id} />
                          </div>
                        )}
                      </div>
                    </Td>
                  </tr>
                )}
                </Fragment>
              );
  };

  return (
    <div className="space-y-4">
      {/* Rate cards moved to Sales › Rate cards (the owner, 2026-11-17); this event's are a click away. */}
      <p className="text-[13px]">
        <Link href={`/sales/rate-cards?event=${eventId}`} className="text-brand-700 hover:underline">
          Rate cards for this event →
        </Link>
      </p>
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

        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search properties…"
          aria-label="Search properties"
          className={`w-56 rounded-full border px-4 py-2 text-[13px] font-light outline-none ${search ? "border-brand-400 bg-brand-50" : "border-ink-200 bg-white"}`}
        />

        <TypePicker value={types} onChange={setTypes} />

        {(providers.data ?? []).length > 0 && (
          <Select value={providerId} onChange={(e) => setProviderId(e.target.value)} className="w-auto" aria-label="Provider">
            <option value="">Every provider</option>
            {(providers.data ?? []).map((provider) => (
              <option key={provider.id} value={provider.id}>
                {provider.name}
              </option>
            ))}
          </Select>
        )}

        <button
          type="button"
          onClick={() => setHasQuotations((current) => !current)}
          aria-pressed={hasQuotations}
          className={`rounded-full px-4 py-2 text-[13px] font-light transition-colors ${
            hasQuotations
              ? "bg-brand-700 text-white"
              : "border-ink-200 text-ink-500 hover:border-brand-400 border bg-white"
          }`}
          title="Only the properties that have sent a quotation — on the list and on the map"
        >
          With quotations
        </button>

        <Select value={area} onChange={(e) => setArea(e.target.value)} className="w-auto" aria-label="Area">
          <option value="">Every area</option>
          {areas.map((name) => (
            <option key={name} value={name}>
              {name}
            </option>
          ))}
        </Select>

        <Select value={roomType} onChange={(e) => setRoomType(e.target.value)} className="w-auto" aria-label="Room type">
          <option value="">Every room type</option>
          {roomTypeGroups.map((group) => (
            <optgroup key={group.kind} label={group.label}>
              {group.types.map((type) => (
                <option key={type.short} value={type.short}>
                  {type.short}
                </option>
              ))}
            </optgroup>
          ))}
        </Select>

        <label className={`flex items-center gap-1.5 rounded-full border px-4 py-2 text-[13px] font-light ${maxRate ? "border-brand-400 bg-brand-50" : "border-ink-200 bg-white"}`}>
          <span className="text-ink-500">Up to</span>
          <input
            inputMode="decimal"
            value={maxRate}
            onChange={(e) => setMaxRate(e.target.value.replace(/[^0-9.,]/g, ""))}
            placeholder="350"
            aria-label="Highest rate per night"
            className="w-14 bg-transparent outline-none"
          />
          <span className="text-ink-500">a night</span>
        </label>

        {filtered && (
          <button
            type="button"
            onClick={() => {
              setTypes([]);
              setProviderId("");
              setHasQuotations(false);
              setArea("");
              setRoomType("");
              setMaxRate("");
              setSearch("");
            }}
            className="text-brand-700 text-[13px] font-light hover:underline"
          >
            Reset filters
          </button>
        )}

        <span className="text-ink-500 ml-auto text-[13px] font-light">
          {entries.isLoading
            ? "Loading…"
            : `${rows.length}${narrowed ? ` of ${allRows.length}` : ""} ${rows.length === 1 && !narrowed ? "property" : "properties"}`}
        </span>
      </div>

      {/* The map shows even with no properties: its Layers panel is where places are added and My Maps imported (doc §3.7). */}
      {rows.length === 0 && !entries.isLoading && view !== "map" ? (
        narrowed && allRows.length > 0 ? (
          <EmptyState
            title="No property matches these filters"
            description="Widen the search, area, room type or price — or reset the filters."
          />
        ) : hasQuotations ? (
          <EmptyState
            title="No property has a quotation yet"
            description="Open a property and add the quotation it sent in its Quotations section — then it shows here and on the map."
          />
        ) : (
          <EmptyState
            title="Nothing on this list yet"
            description="Add properties you could contract for this event. Nothing here commits us to anything — it is research until Phase 2 picks it up."
          />
        )
      ) : view === "map" ? (
        <>
          <NearbySearch
            eventId={eventId}
            pins={pins}
            places={places}
            layers={layers}
            availability={availability.data ?? []}
            onAdded={() => {
              void entries.refetch();
              router.refresh();
            }}
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
          {selected.size > 0 && (
            // Several at once: tick them, then choose the group (doc §3.9).
            <div className="border-ink-200/60 sticky top-2 z-20 flex flex-wrap items-center gap-2 rounded-xl border bg-white/95 px-4 py-2.5 shadow-sm backdrop-blur">
              <span className="text-[13px] font-medium">
                {selected.size} {selected.size === 1 ? "property" : "properties"} ticked
              </span>
              <span className="text-ink-500 text-[13px] font-light">Move to</span>
              {scoutingStatusOrder.map((group) => (
                <button
                  key={group}
                  type="button"
                  disabled={setStatusMutation.isPending}
                  onClick={() => moveTo([...selected], group)}
                  className="rounded-full border px-3 py-1 text-[13px] font-light transition-colors hover:bg-ink-50"
                  style={{ borderColor: scoutingStatusColours[group], color: scoutingStatusColours[group] }}
                >
                  {scoutingStatusLabels[group]}
                </button>
              ))}
              <button type="button" onClick={() => setSelected(new Set())} className="text-ink-500 hover:text-ink-900 ml-auto text-[13px] font-light">
                Clear
              </button>
            </div>
          )}
          {notice && (
            <p className="flex items-start justify-between gap-3 rounded-lg bg-[#fff8e6] px-4 py-2.5 text-[13px] text-[#7a5200]">
              {notice}
              <button type="button" onClick={() => setNotice(null)} aria-label="Dismiss" className="text-lg leading-none">
                ×
              </button>
            </p>
          )}
          {scoutingStatusOrder.map((group) => {
            const sectionRows = rows.filter((entry) => entry.group === group);
            const key = `group-${group}`;
            const collapsed = collapsedGroups.has(key);
            const colour = scoutingStatusColours[group];
            const target = dropOn === group;
            return (
              // Each group is where rows are dropped, open or folded.
              <section
                key={key}
                onDragOver={(e) => {
                  if (!dragging) return;
                  e.preventDefault();
                  e.dataTransfer.dropEffect = "move";
                  if (dropOn !== group) setDropOn(group);
                }}
                onDragLeave={(e) => {
                  if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDropOn(null);
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  if (dragging) moveTo(dragging, group);
                  setDragging(null);
                  setDropOn(null);
                }}
                className={`rounded-xl transition-colors ${target ? "bg-brand-50 ring-brand-400 ring-2 ring-offset-4" : ""}`}
              >
                <div className="mb-2 flex flex-wrap items-baseline gap-x-4 gap-y-1">
                  <button type="button" onClick={() => toggleGroup(key)} aria-expanded={!collapsed} className="flex min-w-0 items-center gap-2 text-left">
                    <svg
                      viewBox="0 0 16 16"
                      fill="none"
                      aria-hidden="true"
                      className={`h-4 w-4 shrink-0 self-center transition-transform ${collapsed ? "" : "rotate-90"}`}
                      style={{ color: colour }}
                    >
                      <path d="M6 4l4 4-4 4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                    <span className="truncate text-[17px] font-semibold" style={{ color: colour }}>
                      {scoutingStatusLabels[group]}
                    </span>
                  </button>
                  <span className="text-ink-500 text-[13px] font-light">
                    {sectionRows.length} {sectionRows.length === 1 ? "property" : "properties"}
                  </span>
                  <span className="text-ink-500 text-xs font-light">{scoutingStatusHints[group]}</span>
                </div>
                {!collapsed &&
                  (sectionRows.length > 0 ? (
                    renderTable(sectionRows, colour)
                  ) : (
                    <div className="border-ink-200 text-ink-500 rounded-xl border border-dashed px-5 py-4 text-[13px] font-light">
                      None yet{dragging ? " — drop here" : " — drag a property here, or tick several and use Move to"}.
                    </div>
                  ))}
              </section>
            );
          })}
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

/**
 * A property's video, which the team sends to clients often (doc §3.9): open
 * it, or copy its link to paste into an email.
 */
function VideoLink({ url }: { url: string }) {
  const [copied, setCopied] = useState(false);
  const href = /^https?:\/\//.test(url) ? url : `https://${url}`;
  return (
    <span className="whitespace-nowrap">
      <a href={href} target="_blank" rel="noreferrer" className="text-brand-700 hover:underline">
        Video ↗
      </a>{" "}
      <button
        type="button"
        onClick={() => {
          void navigator.clipboard.writeText(href).then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
          });
        }}
        className="hover:text-brand-700"
      >
        {copied ? "copied" : "copy link"}
      </button>
    </span>
  );
}

/** "17 Nov", with the year only when it is not this year's. */
function shortDate(date: Date) {
  const sameYear = date.getFullYear() === new Date().getFullYear();
  return date.toLocaleDateString("en-GB", { day: "numeric", month: "short", ...(sameYear ? {} : { year: "numeric" }) });
}

/** Any of several types at once (doc §3.9); none ticked means every type. */
function TypePicker({ value, onChange }: { value: PropertyType[]; onChange: (types: PropertyType[]) => void }) {
  const [open, setOpen] = useState(false);
  const label =
    value.length === 0 ? "Every type" : value.length <= 2 ? value.map((type) => propertyTypeLabels[type]).join(", ") : `${value.length} types`;
  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        aria-expanded={open}
        className={`rounded-full border px-4 py-2 text-[13px] font-light transition-colors ${
          value.length ? "border-brand-400 bg-brand-50 text-brand-800" : "border-ink-200 text-ink-700 bg-white"
        }`}
      >
        {label} ▾
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} aria-hidden="true" />
          <div className="border-ink-200/60 absolute left-0 z-40 mt-1 w-60 rounded-xl border bg-white p-2 shadow-lg">
            {propertyTypeOrder.map((type) => {
              const checked = value.includes(type);
              return (
                <label key={type} className="hover:bg-ink-50 flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-[13px] font-light">
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => onChange(checked ? value.filter((entry) => entry !== type) : [...value, type])}
                    className="accent-brand-400 h-4 w-4"
                  />
                  {propertyTypeLabels[type]}
                </label>
              );
            })}
            {value.length > 0 && (
              <button type="button" onClick={() => onChange([])} className="text-brand-700 mt-1 w-full px-2 py-1 text-left text-[13px] font-light hover:underline">
                Every type
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );
}

/** Kept beside the list so the wording lives in one file: the groups, then the statuses beneath them. */
export function ScoutingStatusKey() {
  return (
    <div className="space-y-4">
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {scoutingStatusOrder.map((status) => (
          <div key={status} className="flex items-start gap-2">
            <ScoutingStatusBadge status={status} />
            <span className="text-ink-500 text-xs font-light">{scoutingStatusHints[status]}</span>
          </div>
        ))}
      </div>
      <p className="text-ink-500 text-xs font-light">
        <span className="text-ink-900 font-medium">Status</span> is the detail beneath the group. It is worked out on its own
        (<em>auto</em>) from the hotel&apos;s contact task and quotations: <em>To be contacted</em>, <em>Quote requested</em>,{" "}
        <em>Quote received</em>, <em>Quote expired</em> (every quote past its <em>valid until</em>), <em>No availability</em> or{" "}
        <em>Couldn&apos;t help</em>. What only a person knows is chosen by hand —{" "}
        {scoutingDetailOrder.map((detail) => scoutingDetailLabels[detail]).join(", ")} — and stays until changed.
      </p>
    </div>
  );
}
