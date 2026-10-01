"use client";

import { keepPreviousData } from "@tanstack/react-query";
import { Fragment, useEffect, useMemo, useRef, useState } from "react";

import { Combobox } from "~/app/_components/combobox";
import { Input } from "~/app/_components/form";
import { InventorySidePanel, type SelectedCell } from "~/app/_components/inventory-side-panel";
import { EmptyState, SectionHeading, SeverityBadge } from "~/app/_components/ui";
import { addDays, dayKey, parseDay } from "~/lib/dates";
import { formatDay, formatMoney } from "~/lib/format";
import { acquisitionLabels, salesLabels } from "~/lib/inventory";
import { severityLabels, type Cause, type Severity } from "~/lib/position";
import { blockKind, buildBlocks, continuesStay, type Block, type BlockKind } from "~/lib/stock-blocks";
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

  // What is in the two date boxes, which becomes the window only once it is a
  // real date and has stopped changing for a moment. The browser's calendar
  // changes the date with every month arrow; applying each of those at once
  // reloaded the sheet under the open calendar and closed it, so a day in
  // another month could never be clicked (Ami's review, 2026-10-01).
  const [checkInBox, setCheckInBox] = useState(checkIn);
  const [checkOutBox, setCheckOutBox] = useState(checkOut);
  useEffect(() => setCheckInBox(checkIn), [checkIn]);
  useEffect(() => setCheckOutBox(checkOut), [checkOut]);
  useEffect(() => {
    // A year still being typed ("0002") is not a date yet.
    const real = (value: string) => /^(19|20|21)\d{2}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(parseDay(value).getTime());
    if (!real(checkInBox) || !real(checkOutBox) || checkOutBox <= checkInBox) return;
    if (checkInBox === checkIn && checkOutBox === checkOut) return;
    const timer = setTimeout(() => {
      setCheckIn(checkInBox);
      setCheckOut(checkOutBox);
    }, 500);
    return () => clearTimeout(timer);
  }, [checkInBox, checkOutBox, checkIn, checkOut]);

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
    // The last sheet stays on screen while the next one loads, so nothing —
    // an open calendar least of all — disappears from under the pointer.
  }, { enabled: restored, placeholderData: keepPreviousData });
  const clients = api.clients.list.useQuery();
  // What is available over the window in view (doc §5.4): whole rooms held
  // by us and not sold on every night of it. Only a sale takes a room — a
  // block is a hold that may lapse, so a blocked room still counts here. This
  // is §5.3's optimistic figure; the Position tab leads with the conservative
  // one. Deliberately not narrowed by the client filter: what is free is free
  // whichever client is asking.
  const available = api.reporting.availability.useQuery(
    {
      eventId,
      propertyId: propertyId || undefined,
      checkIn: parseDay(checkIn),
      checkOut: parseDay(checkOut),
    },
    { enabled: restored, placeholderData: keepPreviousData },
  );

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

  const allProperties = grid.data?.properties ?? [];
  const dates = grid.data?.dates ?? [];
  // One more column than there are nights: the window's check-out day. It is
  // not a night — nothing is drawn in it but CO marks — but it lets a
  // selection end on it, since the last highlighted day is the check-out.
  const columns = useMemo(
    () => (dates.length ? [...dates, addDays(dates[dates.length - 1]!, 1)] : []),
    [dates],
  );
  const cells = grid.data?.cells ?? {};

  // Issues are counted per block, not per night (§5.4): one client at one
  // hotel with the same problem over the same stay is one thing to look at.
  // So the blocks are worked out over every room, open or not.
  const everyRow = useMemo(
    () =>
      allProperties.flatMap((property) =>
        property.categories.flatMap((category) =>
          category.slots.map((slot) => ({ slotId: slot.id, propertyId: property.id, categoryId: category.id })),
        ),
      ),
    [allProperties],
  );
  const everyBlock = useMemo(
    () =>
      buildBlocks(
        everyRow.length,
        dates.length,
        (row, date) => {
          const cell = cells[`${everyRow[row]!.slotId}|${dayKey(dates[date]!)}`];
          if (!cell || !blockKind(cell.position)) return null;
          return {
            sales: cell.position.sales,
            acquisition: cell.position.acquisition,
            clientName: cell.clientName,
            requestedBy: cell.requestedBy.map((r) => r.name),
            severity: cell.position.severity,
          };
        },
        (row) => everyRow[row]!.categoryId,
      ).blocks,
    [everyRow, dates, cells],
  );
  const issues = useMemo(() => {
    const byLevel = new Map<Severity, { keys: Set<string>; slots: Set<string> }>();
    for (const block of everyBlock) {
      if (block.severity === 0) continue;
      const level = byLevel.get(block.severity) ?? { keys: new Set<string>(), slots: new Set<string>() };
      const property = everyRow[block.rows[0]!]!.propertyId;
      // The same client, state and hotel is one issue, even across room types.
      level.keys.add([property, block.kind, block.client ?? "", block.acquisition].join("|"));
      for (const row of block.rows) level.slots.add(everyRow[row]!.slotId);
      byLevel.set(block.severity, level);
    }
    return byLevel;
  }, [everyBlock, everyRow]);

  // Clicking a "Look out for" count shows only the rooms with that issue.
  const [issueFilter, setIssueFilter] = useState<Severity | null>(null);
  const properties = useMemo(() => {
    const wanted = issueFilter ? issues.get(issueFilter)?.slots : null;
    if (!wanted) return allProperties;
    return allProperties
      .map((property) => ({
        ...property,
        categories: property.categories
          .map((category) => ({ ...category, slots: category.slots.filter((slot) => wanted.has(slot.id)) }))
          .filter((category) => category.slots.length > 0),
      }))
      .filter((property) => property.categories.length > 0);
  }, [allProperties, issueFilter, issues]);
  // ...and opens them, since the point is to see them.
  useEffect(() => {
    if (!issueFilter) return;
    setExpandedProperties((open) => new Set([...open, ...properties.map((property) => property.id)]));
    setExpandedCategories(
      (open) => new Set([...open, ...properties.flatMap((property) => property.categories.map((c) => c.id))]),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps -- when the filter is chosen
  }, [issueFilter]);
  // A filter for an issue that no longer exists — fixed, or out of the dates — lapses.
  useEffect(() => {
    if (issueFilter && !issues.has(issueFilter)) setIssueFilter(null);
  }, [issueFilter, issues]);

  // The flat, visible row order the drag-select rectangle is measured
  // against — only rooms belonging to an expanded hotel and category.
  const visibleRows = useMemo(() => {
    const rows: { slotId: string; slotNumber: number; categoryId: string; categorySize: number }[] = [];
    for (const property of properties) {
      if (!expandedProperties.has(property.id)) continue;
      for (const category of property.categories) {
        if (!expandedCategories.has(category.id)) continue;
        for (const slot of category.slots) {
          rows.push({
            slotId: slot.id,
            slotNumber: slot.slotNumber,
            categoryId: category.id,
            categorySize: category.slots.length,
          });
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

  // Neighbouring nights that say the same thing, drawn as one block (§5.4).
  const { blocks, blockAt } = useMemo(
    () =>
      buildBlocks(
        visibleRows.length,
        dates.length,
        (row, date) => {
          const cell = cells[`${visibleRows[row]!.slotId}|${dayKey(dates[date]!)}`];
          if (!cell) return null;
          // Nobody holds it and neither do we: nothing to say, so it stays
          // blank rather than being drawn as a block.
          if (!blockKind(cell.position)) return null;
          return {
            sales: cell.position.sales,
            acquisition: cell.position.acquisition,
            clientName: cell.clientName,
            requestedBy: cell.requestedBy.map((r) => r.name),
            severity: cell.position.severity,
          };
        },
        (row) => visibleRows[row]!.categoryId,
      ),
    [visibleRows, dates, cells],
  );

  // "CO" goes in the cell after a client's last night — the check-out day,
  // which is not a night and would otherwise be blank — unless another
  // client's stay already starts there. The stay's bar runs half way into
  // that cell: the guest leaves during the day, not the night before.
  const checkOutMarks = useMemo(() => {
    const marks = new Map<string, number>();
    for (const block of blocks) {
      if (!hasClient(block.kind)) continue;
      for (const run of block.runs) {
        const day = run.to + 1;
        if (day > dates.length) continue;
        if (day === dates.length) {
          // The window's check-out day: what happens there is the night just
          // after the window. A stay carrying on, or another client's, gets no CO.
          const next = grid.data?.edges.after[visibleRows[run.row]!.slotId];
          if (next && (continuesStay(block, next) || hasClient(blockKind(next)))) continue;
        } else {
          const there = blockAt[run.row]?.[day];
          if (there != null && hasClient(blocks[there]!.kind)) continue;
        }
        marks.set(`${run.row}|${day}`, block.id);
      }
    }
    return marks;
  }, [blocks, blockAt, dates.length, grid.data, visibleRows]);

  // Whether a block's stay really carries on past the window, from the night
  // either side of it — so "CI 10 Jul" is only said when it is true.
  const continues = useMemo(
    () =>
      blocks.map((block) => ({
        before: block.runs.some(
          (run) =>
            run.from === 0 &&
            continuesStay(block, grid.data?.edges.before[visibleRows[run.row]!.slotId]),
        ),
        after: block.runs.some(
          (run) =>
            run.to === dates.length - 1 &&
            continuesStay(block, grid.data?.edges.after[visibleRows[run.row]!.slotId]),
        ),
      })),
    [blocks, grid.data, visibleRows, dates.length],
  );

  const [hovered, setHovered] = useState<{
    block: number;
    x: number;
    y: number;
    /** Set when the pointer is on the block's check-out day rather than one of its nights. */
    checkOutDay?: Date;
  } | null>(null);


  const rectangle = (a: CellRef, b: CellRef) => {
    const rowFrom = Math.min(a.rowIndex, b.rowIndex);
    const rowTo = Math.max(a.rowIndex, b.rowIndex);
    const dateFrom = Math.min(a.dateIndex, b.dateIndex);
    const dateTo = Math.max(a.dateIndex, b.dateIndex);
    return { rowFrom, rowTo, dateFrom, dateTo };
  };

  /** Whether this column is the check-out day of the current selection. */
  const isSelectionCheckOut = (dateIndex: number) => {
    const ref = dragging ? focus : committed?.focus;
    const start = dragging ? anchor : committed?.anchor;
    if (!ref || !start) return false;
    const { dateFrom, dateTo } = rectangle(start, ref);
    return dateTo > dateFrom && dateIndex === dateTo;
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

  // What a highlighted run of days means (§5.4): the first is the check-in and
  // the last the check-out, which is not a night. A single day on its own is
  // that one night — a stay cannot check in and out on the same day — and the
  // check-out column alone is no stay at all.
  const stayOf = (dateFrom: number, dateTo: number) => {
    if (dateFrom >= dates.length) return null;
    const checkIn = columns[dateFrom];
    const checkOut = dateTo > dateFrom ? columns[dateTo] : addDays(columns[dateFrom]!, 1);
    if (!checkIn || !checkOut) return null;
    return { checkIn, checkOut, nights: Math.max(1, dateTo - dateFrom) };
  };

  // Live feedback while dragging, so a rep never has to count rows by eye —
  // committed selections get their own count in the side panel.
  const liveCount = useMemo(() => {
    if (!dragging || !anchor || !focus) return null;
    const { rowFrom, rowTo, dateFrom, dateTo } = rectangle(anchor, focus);
    const rooms = rowTo - rowFrom + 1;
    const stay = stayOf(dateFrom, dateTo);
    if (!stay) return null;
    return { rooms, ...stay };
  }, [dragging, anchor, focus, columns]);

  const selection = useMemo(() => {
    if (!committed) return null;
    const { rowFrom, rowTo, dateFrom, dateTo } = rectangle(committed.anchor, committed.focus);
    const slotIds = visibleRows.slice(rowFrom, rowTo + 1).map((row) => row.slotId);
    const stay = stayOf(dateFrom, dateTo);
    if (!slotIds.length || !stay) return null;
    return { slotIds, checkIn: stay.checkIn, checkOut: stay.checkOut };
  }, [committed, visibleRows, columns]);

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

  // Per room type: rooms with at least half their nights in view free (§5.4).
  const freeByCategory = new Map(
    (available.data ?? []).map((row) => [row.categoryId, row.mostlyFree]),
  );
  const freeInProperty = (property: (typeof properties)[number]) =>
    property.categories.reduce((sum, category) => sum + (freeByCategory.get(category.id) ?? 0), 0);

  // A room type where nobody holds anything in view — no client, and nothing
  // secured from the supplier — is drawn blank (§5.4), so it says why rather
  // than looking broken.
  const nothingSecured = new Set(
    properties.flatMap((property) =>
      property.categories
        .filter((category) =>
          category.slots.every((slot) =>
            dates.every((date) => {
              const cell = cells[`${slot.id}|${dayKey(date)}`];
              return !cell || !blockKind(cell.position);
            }),
          ),
        )
        .map((category) => category.id),
    ),
  );

  return (
    <div>
      <SectionHeading
        title="Stock sheet"
        hint="One cell per room per night. Drag across rooms and dates to select, then edit or remove them in the panel."
      />

      {Object.values(cells).length === 0 ? null : (() => {
        const levels = ([4, 3, 2, 1] as const).filter((level) => issues.has(level));
        return levels.length === 0 ? (
          <p className="text-ink-500 mb-4 text-[13px] font-light">
            Nothing to look out for in this window — every cell is clear.
          </p>
        ) : (
          <>
          {(issues.has(4) || issues.has(3)) && (() => {
            // Critical and urgent are said loudly, above everything else.
            const critical = issues.get(4)?.keys.size ?? 0;
            const urgent = issues.get(3)?.keys.size ?? 0;
            const worst = critical ? 4 : 3;
            return (
              <div className="mb-3 flex flex-wrap items-center gap-3 rounded-xl border-2 border-[#c03654] bg-[#fde8ec] px-4 py-3">
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[#c03654] text-sm font-bold text-white" aria-hidden="true">
                  !
                </span>
                <p className="min-w-0 flex-1 text-[13px] text-[#8e1f36]">
                  <span className="font-semibold">
                    {critical + urgent} room-night{critical + urgent === 1 ? " needs" : "s need"} attention now
                  </span>
                  {" — "}
                  {[critical ? `${critical} critical` : null, urgent ? `${urgent} urgent` : null].filter(Boolean).join(", ")}.
                  <span className="block text-xs font-light">Outlined in red on the sheet. Point at one to see why.</span>
                </p>
                <button
                  type="button"
                  onClick={() => setIssueFilter(issueFilter === worst ? null : worst)}
                  className="rounded-full bg-[#c03654] px-4 py-1.5 text-[13px] font-medium text-white hover:bg-[#a52b46]"
                >
                  {issueFilter === worst ? "Show everything" : "Show only those"}
                </button>
              </div>
            );
          })()}
          <div className="mb-4 flex flex-wrap items-center gap-2">
            <span className="text-ink-500 text-[13px] font-light">Look out for:</span>
            {levels.map((level) => {
              const count = issues.get(level)!.keys.size;
              const active = issueFilter === level;
              return (
                <button
                  key={level}
                  type="button"
                  aria-pressed={active}
                  title={active ? "Show everything again" : `Show only the ${severityLabels[level].toLowerCase()} issues`}
                  onClick={() => setIssueFilter(active ? null : level)}
                  className={`rounded-full transition-shadow ${
                    active ? "ring-ink-900 ring-2 ring-offset-2" : "hover:ring-ink-200 hover:ring-2 hover:ring-offset-1"
                  } ${issueFilter && !active ? "opacity-50" : ""}`}
                >
                  <SeverityBadge severity={level}>
                    {count} {severityLabels[level].toLowerCase()}
                  </SeverityBadge>
                </button>
              );
            })}
            {issueFilter && (
              <button
                type="button"
                onClick={() => setIssueFilter(null)}
                className="text-brand-700 ml-1 text-[13px] font-light hover:underline"
              >
                Show everything
              </button>
            )}
          </div>
          </>
        );
      })()}

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <Combobox
          className="w-52"
          value={propertyId}
          onChange={setPropertyId}
          placeholder="Every property"
          options={allProperties.map((property) => ({
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
            detail: client.shortName,
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
              value={checkInBox}
              onChange={(e) => setCheckInBox(e.target.value)}
              aria-label="From"
            />
          </div>
          <span className="text-ink-400">–</span>
          <div className="w-40">
            <Input
              type="date"
              value={checkOutBox}
              onChange={(e) => setCheckOutBox(e.target.value)}
              aria-label="Until"
            />
          </div>
        </div>
      </div>

      {properties.length > 0 && <Legend />}

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
          onMouseLeave={() => setHovered(null)}
          ref={scroller}
          className="border-ink-200/60 max-h-[calc(100vh-7rem)] overflow-auto overscroll-contain rounded-xl border bg-white"
        >
          <table className="w-full border-collapse text-left text-xs">
            <thead>
              <tr>
                <th className="sticky top-0 left-0 z-30 w-56 min-w-56 border-b border-r shadow-[inset_0_-1px_0_var(--color-ink-200)] border-ink-200/60 bg-white px-3 py-2 font-medium text-ink-500">
                  Hotel / room type / room
                </th>
                {columns.map((date, index) => (
                  <th
                    key={dayKey(date)}
                    title={index === dates.length ? "Check-out day only — the nights shown end the day before" : undefined}
                    className={`border-ink-200/60 sticky top-0 z-20 min-w-9 border-b bg-white shadow-[inset_0_-1px_0_var(--color-ink-200)] px-1 py-2 text-center font-medium ${
                      index === dates.length ? "text-ink-500/50" : "text-ink-500"
                    }`}
                  >
                    {date.getUTCDate()}
                    <span className="block text-[10px] font-light">
                      {date.toLocaleString("en-CH", { month: "short", timeZone: "UTC" })}
                    </span>
                  </th>
                ))}
                {/* Takes up any spare width, so a short window neither
                    stretches the room column nor leaves the rows short. */}
                <th aria-hidden="true" className="sticky top-0 z-20 w-full border-b border-ink-200/60 bg-white shadow-[inset_0_-1px_0_var(--color-ink-200)]" />
              </tr>
            </thead>
            <tbody>
              {properties.map((property) => {
                const propertyOpen = expandedProperties.has(property.id);
                return (
                  <Fragment key={property.id}>
                    <tr className="bg-ink-50/60">
                      <td
                        colSpan={columns.length + 2}
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
                          {available.data && <AvailableTag count={freeInProperty(property)} />}
                          {property.categories.every((category) => nothingSecured.has(category.id)) && (
                            <span className="text-ink-500 ml-2 text-[11px] font-light">
                              Nothing secured for these dates
                            </span>
                          )}
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
                                colSpan={columns.length + 2}
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
                                    {available.data
                                      ? ` · ${roomsAvailable(freeByCategory.get(category.id) ?? 0)}`
                                      : ` · ${category.slots.length} rooms`}
                                    {nothingSecured.has(category.id) && " · nothing secured"}
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
                                    {columns.map((date, dateIndex) => {
                                      const key = `${slot.id}|${dayKey(date)}`;
                                      const cell = cells[key];
                                      const selected = rowIndex >= 0 && inRectangle(rowIndex, dateIndex);
                                      const blockId = rowIndex >= 0 ? blockAt[rowIndex]?.[dateIndex] : null;
                                      const block = blockId != null ? blocks[blockId] : undefined;
                                      const same = (r: number, d: number) =>
                                        blockId != null && blockAt[r]?.[d] === blockId;
                                      // A night joins what is above or below it when that is
                                      // the same block — or the same stay's check-out half-cell,
                                      // where rooms in one stay leave on different days.
                                      const joins = (r: number, d: number) =>
                                        same(r, d) || (blockId != null && checkOutMarks.get(`${r}|${d}`) === blockId);
                                      const edge = {
                                        top: !joins(rowIndex - 1, dateIndex),
                                        bottom: !joins(rowIndex + 1, dateIndex),
                                        left: !same(rowIndex, dateIndex - 1),
                                        // Open on the right when the stay runs on into its
                                        // check-out half-cell.
                                        right:
                                          !same(rowIndex, dateIndex + 1) &&
                                          checkOutMarks.get(`${rowIndex}|${dateIndex + 1}`) !== blockId,
                                      };
                                      const checkOutOf = checkOutMarks.get(`${rowIndex}|${dateIndex}`);
                                      const checkOut = checkOutOf != null ? blocks[checkOutOf] : undefined;
                                      const coJoins = (r: number) =>
                                        checkOutMarks.get(`${r}|${dateIndex}`) === checkOutOf ||
                                        blockAt[r]?.[dateIndex] === checkOutOf;
                                      const coEdge = checkOut && {
                                        top: !coJoins(rowIndex - 1),
                                        bottom: !coJoins(rowIndex + 1),
                                        // Joined to the same stay above or below, it runs to the
                                        // edge of the cell like the rest of that stay does, so the
                                        // shape steps cleanly instead of leaving a notch.
                                        flush: coJoins(rowIndex - 1) || coJoins(rowIndex + 1),
                                      };
                                      const isLabel =
                                        block && block.labelRow === rowIndex && block.labelDate === dateIndex;
                                      const explainBlank =
                                        dateIndex === 0 &&
                                        slot.id === category.slots[0]?.id &&
                                        nothingSecured.has(category.id);
                                      return (
                                        <td
                                          key={key}
                                          data-row={rowIndex >= 0 ? rowIndex : undefined}
                                          data-date={dateIndex}
                                          onMouseDown={(e) => {
                                            if (rowIndex < 0 || e.button !== 0) return;
                                            e.preventDefault();
                                            pointer.current = { x: e.clientX, y: e.clientY };
                                            setHovered(null);
                                            setDragging(true);
                                            setAnchor({ rowIndex, dateIndex });
                                            setFocus({ rowIndex, dateIndex });
                                            setCommitted(null);
                                          }}
                                          onMouseMove={(e) => {
                                            if (dragging) return;
                                            // On a check-out day, the stay leaving is what the rep is
                                            // pointing at.
                                            const shown = checkOutOf ?? blockId;
                                            setHovered(
                                              shown != null
                                                ? {
                                                    block: shown,
                                                    x: e.clientX,
                                                    y: e.clientY,
                                                    checkOutDay: checkOutOf != null ? date : undefined,
                                                  }
                                                : null,
                                            );
                                          }}
                                          className="border-ink-200/60 relative h-8 w-9 min-w-9 cursor-pointer border-b p-0 select-none"
                                        >
                                          {block ? (
                                            <div
                                              className={`absolute ${kindStyles[block.kind]} ${
                                                issueFilter && block.severity !== issueFilter ? "opacity-25" : ""
                                              } ${
                                                edge.top ? "top-[3px]" : "top-0"
                                              } ${edge.bottom ? "bottom-[3px]" : "-bottom-px"} ${
                                                edge.left ? "left-[2px]" : "left-0"
                                              } ${edge.right ? "right-[2px]" : "right-0"} ${
                                                edge.top && edge.left ? "rounded-tl-md" : ""
                                              } ${edge.top && edge.right ? "rounded-tr-md" : ""} ${
                                                edge.bottom && edge.left ? "rounded-bl-md" : ""
                                              } ${edge.bottom && edge.right ? "rounded-br-md" : ""} ${
                                                // An outline round the whole block, not every night —
                                                // thick and coloured where it needs attention.
                                                block.severity >= 2
                                                  ? `${edge.top ? "border-t-2" : ""} ${edge.bottom ? "border-b-2" : ""} ${edge.left ? "border-l-2" : ""} ${edge.right ? "border-r-2" : ""} ${
                                                      block.severity >= 3 ? "border-[#c03654]!" : "border-[#e0a02a]!"
                                                    }`
                                                  : outlined(block.kind)
                                                    ? `${edge.top ? "border-t" : ""} ${edge.bottom ? "border-b" : ""} ${edge.left ? "border-l" : ""} ${edge.right ? "border-r" : ""}`
                                                    : ""
                                              }`}
                                            />
                                          ) : null}
                                          {checkOut && coEdge && (
                                            // The stay's own bar, carried across its check-out day
                                            // and marked CO — drawn over whatever the room does
                                            // next, empty or back to unsold stock.
                                            <span
                                              className={`absolute left-0 z-[2] flex items-center justify-center text-[10px] font-semibold ${
                                                coEdge.flush ? "right-0" : "right-[2px]"
                                              } ${
                                                kindStyles[checkOut.kind]
                                              } ${kindText[checkOut.kind]} ${coEdge.top ? "top-[3px] rounded-tr-md" : "top-0"} ${
                                                coEdge.bottom ? "bottom-[3px] rounded-br-md" : "-bottom-px"
                                              } ${
                                                outlined(checkOut.kind)
                                                  ? `border-r ${coEdge.top ? "border-t" : ""} ${coEdge.bottom ? "border-b" : ""}`
                                                  : ""
                                              }`}
                                            >
                                              CO
                                            </span>
                                          )}
                                          {explainBlank && (
                                            // Free to run on into the empty space to the right: it is
                                            // the only thing on this row.
                                            <span className="text-ink-500 pointer-events-none absolute top-0 bottom-0 left-[6px] z-[1] flex items-center text-[11px] font-light whitespace-nowrap italic">
                                              Nothing secured from the supplier, and no client, for these dates.
                                            </span>
                                          )}
                                          {selected && (
                                            // Over the bars, not under them: a tint on every
                                            // selected night and one outline round the whole
                                            // selection. Its last day is the check-out, not a
                                            // night, so it is tinted lighter and marked CO.
                                            <div
                                              className={`border-brand-900 pointer-events-none absolute inset-0 z-[3] flex items-center justify-center text-[10px] font-bold text-brand-900 ${
                                                isSelectionCheckOut(dateIndex) ? "bg-white/60" : "bg-brand-900/20"
                                              } ${
                                                inRectangle(rowIndex - 1, dateIndex) ? "" : "border-t-2"
                                              } ${inRectangle(rowIndex + 1, dateIndex) ? "" : "border-b-2"} ${
                                                inRectangle(rowIndex, dateIndex - 1) ? "" : "border-l-2"
                                              } ${inRectangle(rowIndex, dateIndex + 1) ? "" : "border-r-2"}`}
                                            >
                                              {isSelectionCheckOut(dateIndex) && "CO"}
                                            </div>
                                          )}
                                          {block && isLabel && (
                                            <BlockLabel
                                              faded={Boolean(issueFilter && block.severity !== issueFilter)}
                                              block={block}
                                              dates={dates}
                                              afterCheckOut={Boolean(checkOut)}
                                              continues={continues[block.id]}
                                            />
                                          )}
                                        </td>
                                      );
                                    })}
                                    <td aria-hidden="true" className="border-ink-200/60 border-b" />
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

      {hovered && !dragging && blocks[hovered.block] && (
        <BlockSummary
          block={blocks[hovered.block]!}
          dates={dates}
          rooms={blocks[hovered.block]!.rows.map((row) => visibleRows[row]!)}
          detail={(() => {
            const b = blocks[hovered.block]!;
            const row = visibleRows[b.labelRow];
            const date = dates[b.labelDate];
            const cell = row && date ? cells[`${row.slotId}|${dayKey(date)}`] : undefined;
            return cell?.position;
          })()}
          recorded={(() => {
            // Every night of the booking, for its notes and prices (doc §5.4).
            const b = blocks[hovered.block]!;
            const nights = b.runs.flatMap((run) =>
              dates.slice(run.from, run.to + 1).map((date) => cells[`${visibleRows[run.row]!.slotId}|${dayKey(date)}`]),
            );
            const distinct = (read: (cell: NonNullable<(typeof nights)[number]>) => string | null) => [
              ...new Set(nights.map((cell) => (cell ? read(cell) : null)).filter((value): value is string => Boolean(value))),
            ];
            // What makes the booking need attention, at its worst on any night.
            const causes: Partial<Record<Cause, Severity>> = {};
            for (const cell of nights) {
              if (!cell) continue;
              for (const [cause, level] of Object.entries(cell.position.causes) as [Cause, Severity][]) {
                if (level > (causes[cause] ?? 0)) causes[cause] = level;
              }
            }
            const dateOf = (read: (cell: NonNullable<(typeof nights)[number]>) => Date | null) =>
              distinct((cell) => {
                const value = read(cell);
                return value ? formatDay(value) : null;
              });
            return {
              causes,
              optionExpiries: dateOf((cell) => (cell.acquisitionState === "OPTION" ? cell.optionExpiry : null)),
              blockExpiries: dateOf((cell) => (cell.salesState === "BLOCKED" ? cell.blockExpiry : null)),
              dueDates: dateOf((cell) => (cell.salesState === "BLOCKED" ? cell.dueDate : null)),
              salesNotes: distinct((cell) => cell.salesNotes),
              supplierNotes: distinct((cell) => cell.acquisitionNotes),
              sellPrices: distinct((cell) =>
                cell.sellPriceCents !== null && cell.sellCurrency ? formatMoney(cell.sellPriceCents, cell.sellCurrency) : null,
              ),
            };
          })()}
          checkOutDay={hovered.checkOutDay}
          continuesBefore={continues[hovered.block]?.before ?? false}
          continuesAfter={continues[hovered.block]?.after ?? false}
          x={hovered.x}
          y={hovered.y}
        />
      )}

      {liveCount && (
        <div className="pointer-events-none fixed bottom-6 left-1/2 z-40 -translate-x-1/2 rounded-full bg-ink-900 px-4 py-2 text-[13px] font-medium whitespace-nowrap text-white shadow-lg">
          CI {shortDay(liveCount.checkIn)} → CO {shortDay(liveCount.checkOut)} · {liveCount.rooms}{" "}
          {liveCount.rooms === 1 ? "room" : "rooms"} × {liveCount.nights}{" "}
          {liveCount.nights === 1 ? "night" : "nights"} = {liveCount.rooms * liveCount.nights} room-nights selected
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
    // In whole pixels: the page scrolls in whole pixels, so a fraction left
    // over would ask it to move by less than one, forever, and the grid would
    // never get its turn.
    overTop: Math.max(0, Math.floor(-(corner?.top ?? rect.top))),
    overBottom: Math.max(0, Math.floor(rect.bottom - window.innerHeight)),
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

// --- Blocks (doc §5.4) -------------------------------------------------------

const kindLabels: Record<BlockKind, string> = {
  SOLD: "Sold",
  BLOCKED: "Blocked",
  OUR_STOCK: "Our stock, unsold",
};

const kindStyles: Record<BlockKind, string> = {
  SOLD: "bg-brand-500",
  BLOCKED: "bg-brand-100 border-brand-300",
  // A solid tint rather than a see-through one, so the row lines behind a
  // block never show through it.
  OUR_STOCK: "bg-[#dcf4eb]",
};

const kindText: Record<BlockKind, string> = {
  SOLD: "text-white",
  BLOCKED: "text-brand-800",
  OUR_STOCK: "text-[#0d8f5d]",
};


const outlined = (kind: BlockKind) => kind === "BLOCKED";

const hasClient = (kind: BlockKind | null) => kind === "SOLD" || kind === "BLOCKED";

const shortDay = (date: Date) =>
  date.toLocaleString("en-CH", { day: "numeric", month: "short", timeZone: "UTC" });

/** "10 Jul", or "10–12 Jul" where the rooms in a block start on different days. */
function dayRange(days: Date[]) {
  const times = days.map((day) => day.getTime());
  const first = new Date(Math.min(...times));
  const last = new Date(Math.max(...times));
  if (first.getTime() === last.getTime()) return shortDay(first);
  return first.getUTCMonth() === last.getUTCMonth()
    ? `${first.getUTCDate()}–${shortDay(last)}`
    : `${shortDay(first)} – ${shortDay(last)}`;
}

function stayDates(block: Block, dates: Date[]) {
  const checkIn = dayRange(block.runs.map((run) => dates[run.from]!));
  const checkOut = dayRange(block.runs.map((run) => addDays(dates[run.to]!, 1)));
  return { checkIn, checkOut };
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** The one label a block carries: who, what, check-in, check-out, how many rooms. */
function BlockLabel({
  block,
  dates,
  afterCheckOut,
  continues,
  faded,
}: {
  faded?: boolean;
  block: Block;
  dates: Date[];
  /** The block starts on another client's check-out day: leave that cell to the "CO". */
  afterCheckOut: boolean;
  continues?: { before: boolean; after: boolean };
}) {
  const stay = stayDates(block, dates);
  const checkIn = continues?.before ? `before ${stay.checkIn}` : stay.checkIn;
  const checkOut = continues?.after ? `after ${stay.checkOut}` : stay.checkOut;
  const parts = [
    block.client ?? kindLabels[block.kind],
    block.client ? kindLabels[block.kind] : null,
    hasClient(block.kind) ? `CI ${checkIn} · CO ${checkOut}` : `${checkIn} – ${checkOut}`,
    block.rows.length > 1 ? plural(block.rows.length, "room", "rooms") : null,
  ].filter(Boolean);
  return (
    <span
      // As wide as the block's first stretch of nights: the cells are all the
      // same width, so a multiple of this one is exactly that.
      style={
        afterCheckOut
          ? { left: "100%", width: `calc(${(block.labelSpan - 1) * 100}% - 6px)` }
          : { left: "6px", width: `calc(${block.labelSpan * 100}% - 10px)` }
      }
      className={`pointer-events-none absolute top-0 bottom-0 z-[1] ${faded ? "opacity-40" : ""} flex items-center gap-1 overflow-hidden text-[11px] leading-none font-medium whitespace-nowrap ${kindText[block.kind]}`}
    >
      {block.severity >= 2 && <AttentionMark severity={block.severity} />}
      <span className="truncate">{parts.join(" · ")}</span>
    </span>
  );
}

function AttentionMark({ severity }: { severity: Severity }) {
  return (
    <span
      aria-label={severityLabels[severity]}
      className={`inline-flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full text-[9px] font-bold text-white ${
        severity >= 3 ? "bg-[#c03654]" : "bg-[#e0a02a]"
      }`}
    >
      !
    </span>
  );
}

/** The hover card: who holds what, for when, and what we hold from the supplier. */
function BlockSummary({
  block,
  dates,
  rooms,
  detail,
  recorded,
  checkOutDay,
  continuesBefore,
  continuesAfter,
  x,
  y,
}: {
  block: Block;
  dates: Date[];
  rooms: { slotNumber: number; categorySize: number }[];
  detail?: { headline: string; detail: string | null; flags: string[] };
  recorded: {
    causes: Partial<Record<Cause, Severity>>;
    optionExpiries: string[];
    blockExpiries: string[];
    dueDates: string[];
    salesNotes: string[];
    supplierNotes: string[];
    sellPrices: string[];
  };
  checkOutDay?: Date;
  continuesBefore: boolean;
  continuesAfter: boolean;
  x: number;
  y: number;
}) {
  const { checkIn, checkOut } = stayDates(block, dates);
  const numbers = rooms.map((room) => room.slotNumber).sort((a, b) => a - b);
  const contiguous = numbers.every((n, i) => i === 0 || n === numbers[i - 1]! + 1);
  const roomList =
    numbers.length === 1
      ? `#${numbers[0]}`
      : contiguous
        ? `#${numbers[0]}–#${numbers.at(-1)}`
        : numbers.slice(0, 8).map((n) => `#${n}`).join(", ") + (numbers.length > 8 ? "…" : "");
  const nights = block.uniform ? block.runs[0]!.to - block.runs[0]!.from + 1 : null;
  // Keep the card on screen near the right and bottom edges.
  const left = Math.min(x + 14, window.innerWidth - 300);
  const top = y + 16 + 220 > window.innerHeight ? y - 16 - 220 : y + 16;

  return (
    <div
      className="pointer-events-none fixed z-[1030] w-72 rounded-xl bg-white p-3 text-[12px] shadow-xl ring-1 ring-black/5"
      style={{ left, top }}
    >
      {checkOutDay && (
        <p className="bg-brand-50 text-brand-800 -mx-1 mb-2 rounded-md px-2 py-1 text-[12px] font-medium">
          Check-out day: {shortDay(checkOutDay)}
          <span className="block text-[11px] font-light">
            The guest leaves this day — it is not a night of the stay.
          </span>
        </p>
      )}
      <p className="text-ink-900 flex items-center gap-1.5 text-[13px] font-semibold">
        {block.severity >= 2 && <AttentionMark severity={block.severity} />}
        {block.client ?? kindLabels[block.kind]}
      </p>
      <dl className="mt-2 grid grid-cols-[6.5rem_1fr] gap-x-2 gap-y-1 font-light">
        <dt className="text-ink-500">Sales</dt>
        <dd className="text-ink-900">
          {block.kind === "OUR_STOCK" ? "No client" : salesLabels[block.sales]}
          {block.client && hasClient(block.kind) ? ` — ${block.client}` : ""}
        </dd>
        {block.requestedBy.length > 0 && (
          <>
            <dt className="text-ink-500">Requested by</dt>
            <dd className="text-ink-900">{block.requestedBy.join(", ")}</dd>
          </>
        )}
        <dt className="text-ink-500">Acquisition</dt>
        <dd className="text-ink-900">
          <Culprit level={recorded.causes.acquisition}>{acquisitionLabels[block.acquisition]}</Culprit>
        </dd>
        {recorded.optionExpiries.length > 0 && (
          <>
            <dt className="text-ink-500">Option runs to</dt>
            <dd className="text-ink-900">
              <Culprit level={recorded.causes.optionExpiry}>{recorded.optionExpiries.join(", ")}</Culprit>
            </dd>
          </>
        )}
        {block.kind === "BLOCKED" && recorded.blockExpiries.length > 0 && (
          <>
            <dt className="text-ink-500">Block runs to</dt>
            <dd className="text-ink-900">
              <Culprit level={recorded.causes.blockExpiry}>{recorded.blockExpiries.join(", ")}</Culprit>
            </dd>
          </>
        )}
        {block.kind === "BLOCKED" && recorded.dueDates.length > 0 && (
          <>
            <dt className="text-ink-500">Due</dt>
            <dd className="text-ink-900">
              <Culprit level={recorded.causes.dueDate}>{recorded.dueDates.join(", ")}</Culprit>
            </dd>
          </>
        )}
        <dt className="text-ink-500">{hasClient(block.kind) ? "Check-in" : "From"}</dt>
        <dd className="text-ink-900">
          {continuesBefore ? `before ${checkIn}` : checkIn}
        </dd>
        <dt className="text-ink-500">{hasClient(block.kind) ? "Check-out" : "Until"}</dt>
        <dd className="text-ink-900">
          {continuesAfter ? `after ${checkOut}` : checkOut}
          {nights && !continuesBefore && !continuesAfter && (
            <span className="text-ink-500"> · {plural(nights, "night", "nights")}</span>
          )}
        </dd>
        <dt className="text-ink-500">Rooms</dt>
        <dd className="text-ink-900">
          {plural(numbers.length, "room", "rooms")} of {rooms[0]?.categorySize ?? numbers.length} · {roomList}
        </dd>
        {hasClient(block.kind) && recorded.sellPrices.length > 0 && (
          <>
            <dt className="text-ink-500">Client pays</dt>
            <dd className="text-ink-900">
              {recorded.sellPrices.length === 1 ? `${recorded.sellPrices[0]} a night` : `varies — ${recorded.sellPrices.join(", ")}`}
            </dd>
          </>
        )}
        {recorded.salesNotes.length > 0 && (
          <>
            <dt className="text-ink-500">Client notes</dt>
            <dd className="text-ink-900 whitespace-pre-line">{recorded.salesNotes.join("\n")}</dd>
          </>
        )}
        {recorded.supplierNotes.length > 0 && (
          <>
            <dt className="text-ink-500">Supplier notes</dt>
            <dd className="text-ink-900 whitespace-pre-line">{recorded.supplierNotes.join("\n")}</dd>
          </>
        )}
      </dl>
      {!block.uniform && (
        <p className="text-ink-500 mt-2 font-light">Not every room checks in and out on the same day.</p>
      )}
      {detail && (
        <p className="border-ink-200/60 text-ink-700 mt-2 border-t pt-2 font-light">
          {detail.headline}
          {detail.detail && <span className="text-ink-500 block">{detail.detail}</span>}
          {detail.flags.map((flag) => (
            <span key={flag} className="block text-[#c03654]">
              {flag}
            </span>
          ))}
        </p>
      )}
      {(continuesBefore || continuesAfter) && (
        <p className="text-ink-500 mt-2 text-[11px] font-light">
          This carries on past the dates shown — widen them to see all of it.
        </p>
      )}
    </div>
  );
}

/**
 * A fact in the hover card, marked when it is what makes the booking need
 * attention — so the cause is the first thing the eye lands on.
 */
function Culprit({ level, children }: { level?: Severity; children: React.ReactNode }) {
  if (!level || level < 2) return <>{children}</>;
  const red = level >= 3;
  return (
    <span
      className={`-mx-1.5 inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 font-medium ${
        red ? "bg-[#fde8ec] text-[#a3243d] ring-1 ring-[#c03654]/40" : "bg-[#fdf1dc] text-[#8a5a0f] ring-1 ring-[#e0a02a]/50"
      }`}
    >
      <AttentionMark severity={level} />
      {children}
    </span>
  );
}

function Legend() {
  const shown: BlockKind[] = ["SOLD", "BLOCKED", "OUR_STOCK"];
  return (
    <div className="text-ink-500 mb-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-[12px] font-light">
      {shown.map((kind) => (
        <span key={kind} className="flex items-center gap-1.5">
          <span
            className={`relative inline-block h-3 w-5 overflow-hidden rounded-sm ${kindStyles[kind]} ${outlined(kind) ? "border" : ""}`}
          />
          {kindLabels[kind]}
        </span>
      ))}
      <span className="flex items-center gap-1.5">
        <span className="bg-brand-500 inline-flex h-3 w-5 items-center justify-center rounded-sm text-[7px] font-semibold text-white">
          CO
        </span>
        Check-out day
      </span>
      <span className="flex items-center gap-1.5">
        <span className="inline-block h-3 w-5 rounded-sm border-2 border-[#e0a02a] bg-white" />
        <AttentionMark severity={2} /> Warning
      </span>
      <span className="flex items-center gap-1.5">
        <span className="inline-block h-3 w-5 rounded-sm border-2 border-[#c03654] bg-white" />
        <AttentionMark severity={3} /> Urgent or critical — point at it for why
      </span>
    </div>
  );
}

/** "25 rooms available" — always spelled out in full, so it cannot be misread. */
function roomsAvailable(count: number) {
  if (count === 0) return "No rooms available";
  return `${count} ${count === 1 ? "room" : "rooms"} available`;
}

/** Beside a hotel's name — green when there is anything to offer. */
function AvailableTag({ count }: { count: number }) {
  return (
    <span
      className={`ml-2 inline-flex rounded-full px-2 py-0.5 text-[11px] font-medium ${
        count > 0 ? "bg-[#12b878]/10 text-[#0d8f5d]" : "bg-ink-50 text-ink-500"
      }`}
    >
      {roomsAvailable(count)}
    </span>
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
