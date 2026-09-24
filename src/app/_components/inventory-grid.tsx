"use client";

import { Fragment, useMemo, useState } from "react";

import { Combobox } from "~/app/_components/combobox";
import { Input } from "~/app/_components/form";
import { InventorySidePanel, type SelectedCell } from "~/app/_components/inventory-side-panel";
import { EmptyState, SectionHeading, SeverityBadge } from "~/app/_components/ui";
import { addDays, dayKey, parseDay } from "~/lib/dates";
import { severityLabels, severityStyles, type Severity } from "~/lib/position";
import { api } from "~/trpc/react";

/** A drag-select anchor/end, addressed by position rather than id, so the
 * rectangle between two points is a simple index range. */
type CellRef = { rowIndex: number; dateIndex: number };

/**
 * The Inventory tab's primary view (doc §4, the "Duvet" rework): supplier /
 * room category / room down the rows, dates across the columns, one cell per
 * room-night. Replaces the old stock-sheet list. Editing happens by
 * highlighting cells here, which opens `InventorySidePanel` on the resulting
 * rectangle — the same `{ slotIds, checkIn, checkOut }` shape
 * `inventory.applyChange` already takes.
 */
export function InventoryGrid({
  eventId,
  defaultCheckIn,
  defaultCheckOut,
  onChanged,
}: {
  eventId: string;
  defaultCheckIn: string;
  defaultCheckOut: string;
  onChanged: () => void;
}) {
  const [propertyId, setPropertyId] = useState("");
  const [clientId, setClientId] = useState("");
  const [checkIn, setCheckIn] = useState(defaultCheckIn);
  const [checkOut, setCheckOut] = useState(defaultCheckOut);

  const [expandedProperties, setExpandedProperties] = useState<Set<string>>(new Set());
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(new Set());

  const [anchor, setAnchor] = useState<CellRef | null>(null);
  const [focus, setFocus] = useState<CellRef | null>(null);
  const [dragging, setDragging] = useState(false);
  const [committed, setCommitted] = useState<{ anchor: CellRef; focus: CellRef } | null>(null);

  const grid = api.inventory.grid.useQuery({
    eventId,
    propertyId: propertyId || undefined,
    clientId: clientId || undefined,
    checkIn: parseDay(checkIn),
    checkOut: parseDay(checkOut),
  });
  const clients = api.clients.list.useQuery();

  const toggleSet = (
    setter: React.Dispatch<React.SetStateAction<Set<string>>>,
    id: string,
  ) =>
    setter((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const properties = grid.data?.properties ?? [];
  const dates = grid.data?.dates ?? [];
  const cells = grid.data?.cells ?? {};

  // The flat, visible row order the drag-select rectangle is measured
  // against — only rooms belonging to an expanded hotel and category.
  const visibleRows = useMemo(() => {
    const rows: { slotId: string; slotNumber: number }[] = [];
    for (const property of properties) {
      if (!expandedProperties.has(property.id)) continue;
      for (const category of property.categories) {
        if (!expandedCategories.has(category.id)) continue;
        for (const slot of category.slots) {
          rows.push({ slotId: slot.id, slotNumber: slot.slotNumber });
        }
      }
    }
    return rows;
  }, [properties, expandedProperties, expandedCategories]);

  const rowIndexBySlot = useMemo(() => {
    const map = new Map<string, number>();
    visibleRows.forEach((row, index) => map.set(row.slotId, index));
    return map;
  }, [visibleRows]);

  const severityCounts = useMemo(() => {
    const counts: Record<Severity, number> = { 0: 0, 1: 0, 2: 0, 3: 0, 4: 0 };
    for (const cell of Object.values(cells)) counts[cell.position.severity]++;
    return counts;
  }, [cells]);

  const rectangle = (a: CellRef, b: CellRef) => {
    const rowFrom = Math.min(a.rowIndex, b.rowIndex);
    const rowTo = Math.max(a.rowIndex, b.rowIndex);
    const dateFrom = Math.min(a.dateIndex, b.dateIndex);
    const dateTo = Math.max(a.dateIndex, b.dateIndex);
    return { rowFrom, rowTo, dateFrom, dateTo };
  };

  const inRectangle = (rowIndex: number, dateIndex: number) => {
    const ref = dragging ? focus : committed?.focus;
    const start = dragging ? anchor : committed?.anchor;
    if (!ref || !start) return false;
    const { rowFrom, rowTo, dateFrom, dateTo } = rectangle(start, ref);
    return (
      rowIndex >= rowFrom &&
      rowIndex <= rowTo &&
      dateIndex >= dateFrom &&
      dateIndex <= dateTo
    );
  };

  // Live feedback while dragging, so a rep never has to count rows by eye —
  // committed selections get their own count in the side panel.
  const liveCount = useMemo(() => {
    if (!dragging || !anchor || !focus) return null;
    const { rowFrom, rowTo, dateFrom, dateTo } = rectangle(anchor, focus);
    const rooms = rowTo - rowFrom + 1;
    const nights = dateTo - dateFrom + 1;
    return { rooms, nights };
  }, [dragging, anchor, focus]);

  const selection = useMemo(() => {
    if (!committed) return null;
    const { rowFrom, rowTo, dateFrom, dateTo } = rectangle(committed.anchor, committed.focus);
    const slotIds = visibleRows.slice(rowFrom, rowTo + 1).map((row) => row.slotId);
    const from = dates[dateFrom];
    const to = dates[dateTo];
    if (!slotIds.length || !from || !to) return null;
    return { slotIds, checkIn: from, checkOut: addDays(to, 1) };
  }, [committed, visibleRows, dates]);

  const selectedCells: SelectedCell[] = useMemo(() => {
    if (!selection) return [];
    const found: SelectedCell[] = [];
    for (const date of dates) {
      if (date < selection.checkIn || date >= selection.checkOut) continue;
      for (const slotId of selection.slotIds) {
        const cell = cells[`${slotId}|${dayKey(date)}`];
        if (cell) found.push({ key: `${slotId}|${dayKey(date)}`, ...cell });
      }
    }
    return found;
  }, [selection, dates, cells]);

  const clearSelection = () => {
    setCommitted(null);
    setAnchor(null);
    setFocus(null);
  };

  if (grid.isLoading) return null;

  return (
    <div>
      <SectionHeading
        title="Stock sheet"
        hint="One cell per room per night. Drag across rooms and dates to select, then edit or remove them in the panel."
      />

      {Object.values(cells).length === 0 ? null : (() => {
        const issues = ([4, 3, 2, 1] as const).filter((sev) => severityCounts[sev] > 0);
        return issues.length === 0 ? (
          <p className="text-ink-500 mb-4 text-[13px] font-light">
            Nothing to look out for in this window — every cell is clear.
          </p>
        ) : (
          <div className="mb-4 flex flex-wrap items-center gap-2">
            <span className="text-ink-500 text-[13px] font-light">Look out for:</span>
            {issues.map((sev) => (
              <SeverityBadge key={sev} severity={sev}>
                {severityCounts[sev]} {severityLabels[sev].toLowerCase()}
              </SeverityBadge>
            ))}
          </div>
        );
      })()}

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <Combobox
          className="w-52"
          value={propertyId}
          onChange={setPropertyId}
          placeholder="Every property"
          options={properties.map((property) => ({
            id: property.id,
            label: property.name,
          }))}
        />

        <Combobox
          className="w-52"
          value={clientId}
          onChange={setClientId}
          placeholder="Every client"
          options={(clients.data ?? []).map((client) => ({
            id: client.id,
            label: client.name,
          }))}
        />

        <div className="ml-auto flex items-center gap-2">
          <div className="w-40">
            <Input
              type="date"
              value={checkIn}
              onChange={(e) => setCheckIn(e.target.value)}
            />
          </div>
          <span className="text-ink-400">–</span>
          <div className="w-40">
            <Input
              type="date"
              value={checkOut}
              onChange={(e) => setCheckOut(e.target.value)}
            />
          </div>
        </div>
      </div>

      {properties.length === 0 ? (
        <EmptyState
          title="Nothing matches"
          description="Nothing in this event's inventory matches the current filters and date window."
        />
      ) : (
        <div
          className="border-ink-200/60 overflow-auto rounded-xl border bg-white"
          onMouseUp={() => {
            if (dragging && anchor && focus) setCommitted({ anchor, focus });
            setDragging(false);
          }}
          onMouseLeave={() => {
            if (dragging && anchor && focus) setCommitted({ anchor, focus });
            setDragging(false);
          }}
        >
          <table className="border-collapse text-left text-xs">
            <thead>
              <tr>
                <th className="sticky left-0 z-10 min-w-56 border-b border-r border-ink-200/60 bg-white px-3 py-2 font-medium text-ink-500">
                  Hotel / room type / room
                </th>
                {dates.map((date) => (
                  <th
                    key={dayKey(date)}
                    className="border-ink-200/60 min-w-9 border-b px-1 py-2 text-center font-medium text-ink-500"
                  >
                    {date.getUTCDate()}
                    <span className="block text-[10px] font-light">
                      {date.toLocaleString("en-CH", { month: "short", timeZone: "UTC" })}
                    </span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {properties.map((property) => {
                const propertyOpen = expandedProperties.has(property.id);
                return (
                  <Fragment key={property.id}>
                    <tr className="bg-ink-50/60">
                      <td
                        colSpan={dates.length + 1}
                        className="sticky left-0 z-10 border-b border-ink-200/60 bg-ink-50/60 px-3 py-2"
                      >
                        <button
                          type="button"
                          onClick={() => toggleSet(setExpandedProperties, property.id)}
                          className="text-ink-900 flex items-center gap-1.5 font-medium"
                        >
                          <Chevron open={propertyOpen} />
                          {property.name}
                          {property.stars ? ` · ${property.stars}★` : ""}
                        </button>
                      </td>
                    </tr>

                    {propertyOpen &&
                      property.categories.map((category) => {
                        const categoryOpen = expandedCategories.has(category.id);
                        return (
                          <Fragment key={category.id}>
                            <tr>
                              <td
                                colSpan={dates.length + 1}
                                className="sticky left-0 z-10 border-b border-ink-200/60 bg-white px-3 py-1.5 pl-6"
                              >
                                <button
                                  type="button"
                                  onClick={() => toggleSet(setExpandedCategories, category.id)}
                                  className="text-ink-700 flex items-center gap-1.5 text-[12px] font-medium"
                                >
                                  <Chevron open={categoryOpen} />
                                  {category.name}
                                  <span className="text-ink-500 font-light">
                                    · {category.slots.length} rooms
                                  </span>
                                </button>
                              </td>
                            </tr>

                            {categoryOpen &&
                              category.slots.map((slot) => {
                                const rowIndex = rowIndexBySlot.get(slot.id) ?? -1;
                                return (
                                  <tr key={slot.id}>
                                    <td className="border-ink-200/60 sticky left-0 z-10 border-b bg-white px-3 py-1 pl-10 font-medium text-ink-700">
                                      #{slot.slotNumber}
                                    </td>
                                    {dates.map((date, dateIndex) => {
                                      const key = `${slot.id}|${dayKey(date)}`;
                                      const cell = cells[key];
                                      const selected = rowIndex >= 0 && inRectangle(rowIndex, dateIndex);
                                      return (
                                        <td
                                          key={key}
                                          onMouseDown={() => {
                                            if (rowIndex < 0) return;
                                            setDragging(true);
                                            setAnchor({ rowIndex, dateIndex });
                                            setFocus({ rowIndex, dateIndex });
                                            setCommitted(null);
                                          }}
                                          onMouseEnter={() => {
                                            if (dragging && rowIndex >= 0) setFocus({ rowIndex, dateIndex });
                                          }}
                                          title={cell?.position.headline}
                                          className={`border-ink-200/40 h-8 w-9 cursor-pointer select-none border-b text-center align-middle ${
                                            cell ? severityStyles[cell.position.severity] : "bg-ink-50/40 text-ink-300"
                                          } ${selected ? "ring-brand-400 ring-2 ring-inset" : ""}`}
                                        >
                                          {cell ? cell.position.icon : ""}
                                        </td>
                                      );
                                    })}
                                  </tr>
                                );
                              })}
                          </Fragment>
                        );
                      })}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {liveCount && (
        <div className="pointer-events-none fixed bottom-6 left-1/2 z-40 -translate-x-1/2 rounded-full bg-ink-900 px-4 py-2 text-[13px] font-medium whitespace-nowrap text-white shadow-lg">
          {liveCount.rooms} {liveCount.rooms === 1 ? "room" : "rooms"} ×{" "}
          {liveCount.nights} {liveCount.nights === 1 ? "night" : "nights"} ={" "}
          {liveCount.rooms * liveCount.nights} room-nights selected
        </div>
      )}

      {selection && (
        <InventorySidePanel
          eventId={eventId}
          slotIds={selection.slotIds}
          checkIn={selection.checkIn}
          checkOut={selection.checkOut}
          roomCount={selection.slotIds.length}
          cells={selectedCells}
          onClose={clearSelection}
          onApplied={() => {
            onChanged();
            clearSelection();
          }}
        />
      )}
    </div>
  );
}

function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      className={`h-3 w-3 shrink-0 transition-transform ${open ? "rotate-90" : ""}`}
    >
      <path
        d="M6 4l4 4-4 4"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
