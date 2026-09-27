"use client";

import { Fragment, useEffect, useMemo, useRef, useState } from "react";

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
  // The check-in/check-out window is remembered per event, in this browser,
  // so coming back to the tab does not snap it back to the event's dates.
  // Read after mount — storage only exists in the browser — and the sheet
  // waits for it, rather than loading the event's dates first and then the
  // remembered ones.
  const [checkIn, setCheckIn] = useState(defaultCheckIn);
  const [checkOut, setCheckOut] = useState(defaultCheckOut);
  const [restored, setRestored] = useState(false);
  useEffect(() => {
    const saved = readWindow(eventId);
    if (saved) {
      setCheckIn(saved.checkIn);
      setCheckOut(saved.checkOut);
    }
    setRestored(true);
  }, [eventId]);
  useEffect(() => {
    if (restored) writeWindow(eventId, checkIn, checkOut, defaultCheckIn, defaultCheckOut);
  }, [restored, eventId, checkIn, checkOut, defaultCheckIn, defaultCheckOut]);
  const isEventWindow = checkIn === defaultCheckIn && checkOut === defaultCheckOut;

  const [expandedProperties, setExpandedProperties] = useState<Set<string>>(new Set());
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(new Set());

  const [anchor, setAnchor] = useState<CellRef | null>(null);
  const [focus, setFocus] = useState<CellRef | null>(null);
  const [dragging, setDragging] = useState(false);
  const [committed, setCommitted] = useState<{ anchor: CellRef; focus: CellRef } | null>(null);

  const scroller = useRef<HTMLDivElement>(null);
  const pointer = useRef<{ x: number; y: number } | null>(null);
  // The latest drag state, for the window listeners below.
  const drag = useRef({ anchor, focus });
  drag.current = { anchor, focus };

  // While dragging, the selection keeps going when the pointer leaves the
  // grid: near or past an edge the grid scrolls that way, faster the further
  // out the pointer is, and the selection follows to whichever cell is now
  // under it. Letting go anywhere on the page finishes the selection.
  //
  // "Edge" means the edge you can see. The grid is as tall as the window, so
  // when the page is not scrolled right down to it, its own bottom sits below
  // the screen where the pointer cannot reach — dragging to the bottom of the
  // screen then scrolls the page until the grid is in view, and only then
  // the grid itself. The same going up.
  useEffect(() => {
    if (!dragging) return;
    let frame = 0;

    const cellUnderPointer = () => {
      const box = scroller.current;
      const at = pointer.current;
      if (!box || !at) return;
      const area = visibleCellArea(box);
      // Clamp into the visible cells, so a pointer over the pinned date row or
      // room column — or off the grid, or off the screen — still lands on one.
      const x = Math.min(Math.max(at.x, area.left + 2), area.right - 2);
      const y = Math.min(Math.max(at.y, area.top + 2), area.bottom - 2);
      const cell = document.elementFromPoint(x, y)?.closest<HTMLElement>("td[data-row]");
      if (!cell) return;
      const rowIndex = Number(cell.dataset.row);
      const dateIndex = Number(cell.dataset.date);
      const current = drag.current.focus;
      if (current?.rowIndex !== rowIndex || current?.dateIndex !== dateIndex) {
        setFocus({ rowIndex, dateIndex });
      }
    };

    const step = () => {
      const box = scroller.current;
      const at = pointer.current;
      if (box && at) {
        const area = visibleCellArea(box);
        const speed = (overshoot: number) => Math.min(40, Math.max(0, overshoot) / 2 + 4);
        const edge = 32;
        let dx = 0;
        let dy = 0;
        if (at.x > area.right - edge) dx = speed(at.x - (area.right - edge));
        else if (at.x < area.left + edge) dx = -speed(area.left + edge - at.x);
        if (at.y > area.bottom - edge) dy = speed(at.y - (area.bottom - edge));
        else if (at.y < area.top + edge) dy = -speed(area.top + edge - at.y);
        if (dy) {
          // While that edge of the grid is off screen, the page scrolls just
          // far enough to bring it on — never past it, so the grid is not
          // carried away — and after that the grid scrolls.
          if (dy > 0 && area.overBottom > 0) window.scrollBy(0, Math.min(dy, area.overBottom));
          else if (dy < 0 && area.overTop > 0) window.scrollBy(0, Math.max(dy, -area.overTop));
          else box.scrollBy(0, dy);
        }
        if (dx) box.scrollBy(dx, 0);
        if (dx || dy) cellUnderPointer();
      }
      frame = requestAnimationFrame(step);
    };

    const onMove = (e: MouseEvent) => {
      pointer.current = { x: e.clientX, y: e.clientY };
      cellUnderPointer();
    };
    const onUp = () => {
      const { anchor: start, focus: end } = drag.current;
      if (start && end) setCommitted({ anchor: start, focus: end });
      setDragging(false);
      pointer.current = null;
    };

    // Scrolling by wheel or trackpad mid-drag moves the cells under a still
    // pointer; the selection follows those too.
    const box = scroller.current;
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    window.addEventListener("scroll", cellUnderPointer, { passive: true });
    box?.addEventListener("scroll", cellUnderPointer, { passive: true });
    frame = requestAnimationFrame(step);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      window.removeEventListener("scroll", cellUnderPointer);
      box?.removeEventListener("scroll", cellUnderPointer);
      cancelAnimationFrame(frame);
    };
  }, [dragging]);

  const grid = api.inventory.grid.useQuery({
    eventId,
    propertyId: propertyId || undefined,
    clientId: clientId || undefined,
    checkIn: parseDay(checkIn),
    checkOut: parseDay(checkOut),
  }, { enabled: restored });
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

  if (!restored || grid.isLoading) return null;

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
          {!isEventWindow && (
            <button
              type="button"
              onClick={() => {
                setCheckIn(defaultCheckIn);
                setCheckOut(defaultCheckOut);
              }}
              className="text-brand-700 mr-1 text-[13px] font-light hover:underline"
            >
              Back to event dates
            </button>
          )}
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
        // Scrolls both ways inside a box no taller than the window, so the
        // date row can stay pinned along its top and the room column down
        // its left, however far the sheet is scrolled.
        <div
          ref={scroller}
          className="border-ink-200/60 max-h-[calc(100vh-7rem)] overflow-auto overscroll-contain rounded-xl border bg-white"
        >
          <table className="border-collapse text-left text-xs">
            <thead>
              <tr>
                <th className="sticky top-0 left-0 z-30 min-w-56 border-b border-r shadow-[inset_0_-1px_0_var(--color-ink-200)] border-ink-200/60 bg-white px-3 py-2 font-medium text-ink-500">
                  Hotel / room type / room
                </th>
                {dates.map((date) => (
                  <th
                    key={dayKey(date)}
                    className="border-ink-200/60 sticky top-0 z-20 min-w-9 border-b bg-white shadow-[inset_0_-1px_0_var(--color-ink-200)] px-1 py-2 text-center font-medium text-ink-500"
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
                                          data-row={rowIndex >= 0 ? rowIndex : undefined}
                                          data-date={dateIndex}
                                          onMouseDown={(e) => {
                                            if (rowIndex < 0 || e.button !== 0) return;
                                            e.preventDefault();
                                            pointer.current = { x: e.clientX, y: e.clientY };
                                            setDragging(true);
                                            setAnchor({ rowIndex, dateIndex });
                                            setFocus({ rowIndex, dateIndex });
                                            setCommitted(null);
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

/**
 * The part of the grid's cells you can actually see: right of the pinned room
 * column, below the pinned date row, and within the window. The pinned
 * corner cell is measured rather than the header row, because the header row
 * as a whole scrolls away; only its cells are pinned.
 */
function visibleCellArea(box: HTMLElement) {
  const rect = box.getBoundingClientRect();
  const corner = box.querySelector("thead th")?.getBoundingClientRect();
  return {
    left: Math.max(corner?.right ?? rect.left, 0),
    right: Math.min(rect.right, window.innerWidth),
    top: Math.max(corner?.bottom ?? rect.top, 0),
    bottom: Math.min(rect.bottom, window.innerHeight),
    // How far the pinned date row is above the screen, and the grid's
    // bottom below it — what the page must scroll to bring each on.
    overTop: Math.max(0, -(corner?.top ?? rect.top)),
    overBottom: Math.max(0, rect.bottom - window.innerHeight),
  };
}

const windowKey = (eventId: string) => `welodge:inventory-window:${eventId}`;

/** The window last looked at for this event, if it was not the event's own. */
function readWindow(eventId: string): { checkIn: string; checkOut: string } | null {
  try {
    const saved = window.localStorage.getItem(windowKey(eventId));
    if (!saved) return null;
    const parsed = JSON.parse(saved) as { checkIn?: unknown; checkOut?: unknown };
    const valid = (value: unknown): value is string =>
      typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
    return valid(parsed.checkIn) && valid(parsed.checkOut)
      ? { checkIn: parsed.checkIn, checkOut: parsed.checkOut }
      : null;
  } catch {
    // No storage (private browsing, or rendering on the server): the event's dates.
    return null;
  }
}

/**
 * Remember the window — or forget it once it is back to the event's dates, so
 * an event whose dates are later corrected is not stuck on the old ones.
 */
function writeWindow(
  eventId: string,
  checkIn: string,
  checkOut: string,
  defaultCheckIn: string,
  defaultCheckOut: string,
) {
  try {
    if (checkIn === defaultCheckIn && checkOut === defaultCheckOut) {
      window.localStorage.removeItem(windowKey(eventId));
    } else {
      window.localStorage.setItem(windowKey(eventId), JSON.stringify({ checkIn, checkOut }));
    }
  } catch {
    // Losing this is a convenience, not a correctness problem.
  }
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
