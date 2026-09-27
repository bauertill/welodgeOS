import type { AcquisitionState, SalesState } from "generated/prisma";

import type { Severity } from "~/lib/position";

/**
 * The stock sheet draws blocks, not one mark per room-night (doc §5.4).
 * Neighbouring room-nights that say the same thing — same client, same sales
 * state, same acquisition state — are one block: a client holding ten rooms for
 * three weeks is one shape with one label, not 210 identical cells. A block
 * need not be a rectangle; rooms in it may check in or out on different days.
 *
 * Nothing here decides what a night *means* — that is still `positionOf`. This
 * only groups nights that already mean the same thing, so the sheet can say it
 * once.
 */

/** What a block is drawn and labelled from: the displayed state of one night. */
export type BlockNight = {
  sales: SalesState;
  acquisition: AcquisitionState;
  clientName: string | null;
  requestedBy: string[];
  severity: Severity;
};

/** What a rep reads a block as, in the business's own words (doc §10). */
export type BlockKind = "SOLD" | "BLOCKED" | "REQUESTED" | "OUR_STOCK" | "NOT_SECURED" | "RECORD";

export function blockKind(night: Pick<BlockNight, "sales" | "acquisition">): BlockKind {
  if (night.sales === "SOLD") return "SOLD";
  if (night.sales === "BLOCKED") return "BLOCKED";
  if (night.sales === "REQUESTED") return "REQUESTED";
  // Nobody on it: ours to sell if we hold it, otherwise still being
  // negotiated. (Nothing started at all is not a block: the sheet leaves it blank.)
  if (night.acquisition === "BOUGHT" || night.acquisition === "OPTION") return "OUR_STOCK";
  if (night.acquisition === "RELEASED" || night.sales === "CANCELLED") return "RECORD";
  return "NOT_SECURED";
}

/** Who a block is for: the client with the hold, or those asking. */
export function blockClient(night: Pick<BlockNight, "sales" | "clientName" | "requestedBy">) {
  if (night.sales === "SOLD" || night.sales === "BLOCKED") return night.clientName;
  if (night.sales === "REQUESTED") {
    const [first, ...rest] = night.requestedBy;
    if (!first) return null;
    return rest.length ? `${first} +${rest.length}` : first;
  }
  return null;
}

/** Whether a night outside the window carries on the same stay as a block. */
export function continuesStay(
  block: Pick<Block, "kind" | "client" | "acquisition">,
  night: Omit<BlockNight, "severity"> | undefined,
) {
  if (!night) return false;
  return (
    blockKind(night) === block.kind &&
    blockClient(night) === block.client &&
    night.acquisition === block.acquisition
  );
}

/**
 * Two nights belong in the same block when a rep would describe them in the
 * same words. Severity is part of it only when it is worth acting on, so a
 * block splits where, say, one room's option expires sooner than the rest.
 */
function blockKey(night: BlockNight) {
  return [
    blockKind(night),
    night.acquisition,
    blockClient(night) ?? "",
    night.severity >= 2 ? night.severity : "",
  ].join("|");
}

export type Block = {
  id: number;
  kind: BlockKind;
  client: string | null;
  sales: SalesState;
  acquisition: AcquisitionState;
  severity: Severity;
  /** Grid rows (rooms) and night columns it covers. */
  rows: number[];
  firstDate: number;
  /** The last *night*; check-out is the day after. */
  lastDate: number;
  /** Nights in the block, summed over its rooms. */
  roomNights: number;
  /** Whether every room in it has the same check-in and check-out. */
  uniform: boolean;
  /** Where its label goes: the first night of its top row, and how many nights that run has. */
  labelRow: number;
  labelDate: number;
  labelSpan: number;
  /** Per room: the night columns it spans, first to last — for the "CO" mark. */
  runs: { row: number; from: number; to: number }[];
};

/**
 * Groups a sheet into blocks. `nightAt(row, date)` gives the night in that
 * cell, or null where there is none. `groupOf(row)` keeps a block inside one
 * room category, so two room types never merge into one shape.
 */
export function buildBlocks(
  rowCount: number,
  dateCount: number,
  nightAt: (row: number, date: number) => BlockNight | null,
  groupOf: (row: number) => string,
) {
  const blockAt: (number | null)[][] = Array.from({ length: rowCount }, () =>
    Array<number | null>(dateCount).fill(null),
  );
  const keys: (string | null)[][] = Array.from({ length: rowCount }, (_, row) =>
    Array.from({ length: dateCount }, (_, date) => {
      const night = nightAt(row, date);
      return night ? blockKey(night) : null;
    }),
  );
  const blocks: Block[] = [];

  for (let row = 0; row < rowCount; row++) {
    for (let date = 0; date < dateCount; date++) {
      const key = keys[row]![date];
      if (key === null || blockAt[row]![date] !== null) continue;

      // Flood out to every neighbouring cell that reads the same.
      const id = blocks.length;
      const night = nightAt(row, date)!;
      const cells: [number, number][] = [];
      const stack: [number, number][] = [[row, date]];
      blockAt[row]![date] = id;
      while (stack.length) {
        const [r, d] = stack.pop()!;
        cells.push([r, d]);
        for (const [nr, nd] of [
          [r - 1, d],
          [r + 1, d],
          [r, d - 1],
          [r, d + 1],
        ] as const) {
          if (nr < 0 || nd < 0 || nr >= rowCount || nd >= dateCount) continue;
          if (blockAt[nr]![nd] !== null || keys[nr]![nd] !== key) continue;
          if (groupOf(nr) !== groupOf(r)) continue;
          blockAt[nr]![nd] = id;
          stack.push([nr, nd]);
        }
      }

      const byRow = new Map<number, number[]>();
      for (const [r, d] of cells) {
        const list = byRow.get(r);
        if (list) list.push(d);
        else byRow.set(r, [d]);
      }
      const rows = [...byRow.keys()].sort((a, b) => a - b);
      const runs = rows.map((r) => {
        const dates = byRow.get(r)!;
        return { row: r, from: Math.min(...dates), to: Math.max(...dates) };
      });
      const top = runs[0]!;
      // The label runs along the first unbroken stretch of the top row.
      let labelSpan = 1;
      while (blockAt[top.row]![top.from + labelSpan] === id) labelSpan++;

      blocks.push({
        id,
        kind: blockKind(night),
        client: blockClient(night),
        sales: night.sales,
        acquisition: night.acquisition,
        // The worst night in it, so a block never hides a problem.
        severity: Math.max(...cells.map(([r, d]) => nightAt(r, d)!.severity)) as Severity,
        rows,
        firstDate: Math.min(...runs.map((run) => run.from)),
        lastDate: Math.max(...runs.map((run) => run.to)),
        roomNights: cells.length,
        uniform: runs.every((run) => run.from === top.from && run.to === top.to),
        labelRow: top.row,
        labelDate: top.from,
        labelSpan,
        runs,
      });
    }
  }

  return { blocks, blockAt };
}
