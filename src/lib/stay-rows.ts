import type { AcquisitionState, SalesState } from "generated/prisma";

import { addDays, dayKey } from "~/lib/dates";
import { positionOf, type Position } from "~/lib/position";

/**
 * The stock sheet (doc §5.4). The familiar spreadsheet view is **generated,
 * never stored**: adjacent nights on the same slot collapse into one row for as
 * long as nothing about them changes. Edit a row and you are editing the nights
 * beneath it.
 *
 * This is the operation that makes the current spreadsheet fragile — a client
 * dropping three nights is a row split — and it is precisely why the stored
 * grain is a night and the row is derived (doc §2.1).
 */

/** One room-night, flattened for display. */
export type NightRecord = {
  id: string;
  date: Date;

  slotId: string;
  slotNumber: number;
  categoryId: string;
  categoryName: string;
  categorySortOrder: number;
  /** The scouting-time price, used to value nights we have sold but not bought. */
  indicativePriceCents: number | null;
  indicativeCurrency: string;
  propertyId: string;
  propertyName: string;

  acquisitionState: AcquisitionState;
  supplierRef: string | null;
  optionExpiry: Date | null;
  buyPriceCents: number | null;
  buyCurrency: string | null;
  acquisitionOwner: string | null;

  salesState: SalesState;
  clientId: string | null;
  clientName: string | null;
  clientRef: string | null;
  blockExpiry: Date | null;
  dueDate: Date | null;
  sellPriceCents: number | null;
  sellCurrency: string | null;
  salesOwner: string | null;

  /** Clients with a soft request on this night (doc §4.3). */
  requestedBy: { id: string; name: string }[];
};

export type StayRow = Omit<NightRecord, "id" | "date"> & {
  key: string;
  /** The first night of the run. */
  checkIn: Date;
  /** The last night **+ 1 day** — check-out day is never a night (doc §2.1). */
  checkOut: Date;
  nights: number;
  /** Every room-night underneath this row, so an edit knows what it touches. */
  nightIds: string[];
  position: Position;
};

const money = (cents: number | null, currency: string | null) =>
  cents === null ? "" : `${cents}${currency ?? ""}`;

/**
 * The tuple §5.4 collapses on. Requests are part of it because they change what
 * the row *says*: a night two clients are chasing does not belong on the same
 * row as a night nobody has asked about.
 */
function signature(night: NightRecord): string {
  return [
    night.slotId,
    night.acquisitionState,
    night.supplierRef ?? "",
    night.optionExpiry ? dayKey(night.optionExpiry) : "",
    money(night.buyPriceCents, night.buyCurrency),
    night.acquisitionOwner ?? "",
    night.salesState,
    night.clientId ?? "",
    night.clientRef ?? "",
    night.blockExpiry ? dayKey(night.blockExpiry) : "",
    night.dueDate ? dayKey(night.dueDate) : "",
    money(night.sellPriceCents, night.sellCurrency),
    night.salesOwner ?? "",
    night.requestedBy
      .map((r) => r.id)
      .sort()
      .join(","),
  ].join("|");
}

/**
 * Collapses nights into stay rows, grouped property → category → slot number,
 * matching the layout the business already reads.
 *
 * A gap in the dates breaks the run even when everything else matches: three
 * nights bought either side of a night we do not hold are two stays, not one.
 */
export function toStayRows(nights: NightRecord[], today?: Date): StayRow[] {
  const ordered = [...nights].sort(
    (a, b) =>
      a.propertyName.localeCompare(b.propertyName) ||
      a.categorySortOrder - b.categorySortOrder ||
      a.categoryName.localeCompare(b.categoryName) ||
      a.slotNumber - b.slotNumber ||
      a.date.getTime() - b.date.getTime(),
  );

  const rows: StayRow[] = [];
  let current: StayRow | null = null;
  let currentSignature = "";
  let lastNight: Date | null = null;

  for (const night of ordered) {
    const nightSignature = signature(night);
    const contiguous =
      lastNight !== null &&
      dayKey(addDays(lastNight, 1)) === dayKey(night.date);

    if (current && contiguous && nightSignature === currentSignature) {
      current.checkOut = addDays(night.date, 1);
      current.nights += 1;
      current.nightIds.push(night.id);
    } else {
      const { id, date, ...rest } = night;
      current = {
        ...rest,
        key: `${night.slotId}:${dayKey(date)}`,
        checkIn: date,
        checkOut: addDays(date, 1),
        nights: 1,
        nightIds: [id],
        position: positionOf(
          {
            acquisitionState: night.acquisitionState,
            optionExpiry: night.optionExpiry,
            salesState: night.salesState,
            blockExpiry: night.blockExpiry,
            dueDate: night.dueDate,
            clientName: night.clientName,
            requestedBy: night.requestedBy.map((r) => r.name),
          },
          today,
        ),
      };
      rows.push(current);
      currentSignature = nightSignature;
    }

    lastNight = night.date;
  }

  return rows;
}
