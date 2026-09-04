import { addDays, dayKey, daysUntil, today as todayDay } from "~/lib/dates";
import { isHardHold } from "~/lib/inventory";
import {
  REMINDER_WINDOW_DAYS,
  deadlineUrgency,
  displayedSalesState,
  positionOf,
  type DeadlineUrgency,
  type Severity,
} from "~/lib/position";
import type { NightRecord } from "~/lib/stay-rows";

/**
 * The derived views of §5 and the money of §7. Nothing here is stored: every
 * figure is a sum over room-nights, computed on read, so a report can never
 * drift from the position it describes.
 *
 * **Currencies are never converted** (invariant §4.5.9). Every total states the
 * currency it is in, and a total that would have to mix two says so instead of
 * guessing a rate.
 */

export type Money = { currency: string; cents: number };

/** Accumulates cents per currency, because a single total would be a lie. */
class Purse {
  private readonly byCurrency = new Map<string, number>();

  add(cents: number | null | undefined, currency: string | null | undefined) {
    if (cents === null || cents === undefined || !currency) return;
    this.byCurrency.set(currency, (this.byCurrency.get(currency) ?? 0) + cents);
  }

  get total(): Money[] {
    return [...this.byCurrency.entries()]
      .map(([currency, cents]) => ({ currency, cents }))
      .sort((a, b) => b.cents - a.cents);
  }
}

/** What we would expect to pay for a night we have not negotiated a rate for. */
const expectedBuyPrice = (night: NightRecord): Money | null => {
  if (night.buyPriceCents !== null && night.buyCurrency) {
    return { currency: night.buyCurrency, cents: night.buyPriceCents };
  }
  if (night.indicativePriceCents !== null) {
    return {
      currency: night.indicativeCurrency,
      cents: night.indicativePriceCents,
    };
  }
  return null;
};

const held = (night: NightRecord) => night.acquisitionState === "BOUGHT";
const sold = (night: NightRecord) => night.salesState === "SOLD";
const hardHold = (night: NightRecord) => isHardHold(night.salesState);

// ---------------------------------------------------------------------------
// §5.1 — position per property / category / night
// ---------------------------------------------------------------------------

export type PositionCell = {
  propertyId: string;
  propertyName: string;
  categoryId: string;
  categoryName: string;
  date: Date;
  rooms: number;
  /** How many of those rooms sit in each acquisition state. */
  bought: number;
  option: number;
  inProgress: number;
  unstarted: number;
  released: number;
  /** Hard holds. */
  soldCount: number;
  blocked: number;
  /** Request pressure: how many distinct clients are asking, and for how many rooms. */
  requestingClients: number;
  roomsRequested: number;
  /** Net position (doc §5.1). */
  heldRooms: number;
  committed: number;
  short: number;
  long: number;
  /** The loudest severity on this night, for colour and sorting. */
  severity: Severity;
};

export function positionByNight(nights: NightRecord[], today = todayDay()): PositionCell[] {
  const cells = new Map<string, PositionCell & { requesters: Set<string> }>();

  for (const night of nights) {
    const key = `${night.categoryId}|${dayKey(night.date)}`;
    let cell = cells.get(key);
    if (!cell) {
      cell = {
        propertyId: night.propertyId,
        propertyName: night.propertyName,
        categoryId: night.categoryId,
        categoryName: night.categoryName,
        date: night.date,
        rooms: 0,
        bought: 0,
        option: 0,
        inProgress: 0,
        unstarted: 0,
        released: 0,
        soldCount: 0,
        blocked: 0,
        requestingClients: 0,
        roomsRequested: 0,
        heldRooms: 0,
        committed: 0,
        short: 0,
        long: 0,
        severity: 0,
        requesters: new Set<string>(),
      };
      cells.set(key, cell);
    }

    cell.rooms += 1;
    if (night.acquisitionState === "BOUGHT") cell.bought += 1;
    if (night.acquisitionState === "OPTION") cell.option += 1;
    if (night.acquisitionState === "IN_PROGRESS") cell.inProgress += 1;
    if (night.acquisitionState === "NONE") cell.unstarted += 1;
    if (night.acquisitionState === "RELEASED") cell.released += 1;
    if (night.salesState === "SOLD") cell.soldCount += 1;
    if (night.salesState === "BLOCKED") cell.blocked += 1;

    if (night.requestedBy.length) {
      cell.roomsRequested += 1;
      for (const requester of night.requestedBy) cell.requesters.add(requester.id);
    }

    if (held(night)) cell.heldRooms += 1;
    if (sold(night)) cell.committed += 1;
    if (sold(night) && !held(night)) cell.short += 1;
    if (held(night) && !hardHold(night)) cell.long += 1;

    const position = positionOf(
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
    );
    if (position.severity > cell.severity) cell.severity = position.severity;
  }

  return [...cells.values()]
    .map(({ requesters, ...cell }) => ({
      ...cell,
      requestingClients: requesters.size,
    }))
    .sort(
      (a, b) =>
        a.propertyName.localeCompare(b.propertyName) ||
        a.categoryName.localeCompare(b.categoryName) ||
        a.date.getTime() - b.date.getTime(),
    );
}

// ---------------------------------------------------------------------------
// §5.2 — exposure
// ---------------------------------------------------------------------------

export type Exposure = {
  /** Sold or blocked without being bought (doc §10, "short"). */
  short: {
    soldNights: number;
    blockedNights: number;
    /** The buy cost we have not secured, at negotiated or indicative rates. */
    unsecuredCost: Money[];
    /** The revenue we would fail to deliver if we cannot buy it. */
    revenueAtRisk: Money[];
    /** Nights we cannot value at all, because nobody has priced the category. */
    unpriced: number;
  };
  /** Bought with no hard hold — money sitting on the book (doc §10, "long"). */
  long: { nights: number; committedCost: Money[] };
  /** Everything whose option or block runs out inside the reminder window. */
  deadline: { nights: number; value: Money[] };
};

export function exposure(nights: NightRecord[], today = todayDay()): Exposure {
  const unsecuredCost = new Purse();
  const revenueAtRisk = new Purse();
  const committedCost = new Purse();
  const deadlineValue = new Purse();

  let soldNights = 0;
  let blockedNights = 0;
  let unpriced = 0;
  let longNights = 0;
  let deadlineNights = 0;

  for (const night of nights) {
    // Selling before buying is allowed — it is the business — but it is never
    // invisible (invariant §4.5.6).
    if (hardHold(night) && !held(night)) {
      if (night.salesState === "SOLD") soldNights += 1;
      else blockedNights += 1;

      const expected = expectedBuyPrice(night);
      if (expected) unsecuredCost.add(expected.cents, expected.currency);
      else unpriced += 1;

      if (night.salesState === "SOLD") {
        revenueAtRisk.add(night.sellPriceCents, night.sellCurrency);
      }
    }

    if (held(night) && !hardHold(night)) {
      longNights += 1;
      committedCost.add(night.buyPriceCents, night.buyCurrency);
    }

    const optionSoon =
      night.acquisitionState === "OPTION" &&
      daysUntil(night.optionExpiry ?? addDays(today, 999), today) <=
        REMINDER_WINDOW_DAYS;
    const blockSoon =
      night.salesState === "BLOCKED" &&
      daysUntil(night.blockExpiry ?? addDays(today, 999), today) <=
        REMINDER_WINDOW_DAYS;

    if (optionSoon || blockSoon) {
      deadlineNights += 1;
      const expected = expectedBuyPrice(night);
      if (expected) deadlineValue.add(expected.cents, expected.currency);
    }
  }

  return {
    short: {
      soldNights,
      blockedNights,
      unsecuredCost: unsecuredCost.total,
      revenueAtRisk: revenueAtRisk.total,
      unpriced,
    },
    long: { nights: longNights, committedCost: committedCost.total },
    deadline: { nights: deadlineNights, value: deadlineValue.total },
  };
}

// ---------------------------------------------------------------------------
// §5.3 — availability
// ---------------------------------------------------------------------------

export type Availability = {
  propertyId: string;
  propertyName: string;
  categoryId: string;
  categoryName: string;
  /** The window this figure is for: the nights we hold inventory over. */
  from: Date;
  to: Date;
  nights: number;
  slots: number;
  /**
   * The legacy definition, kept as the default: whole slots free on *every*
   * night, where free means held by us and not sold. Optimistic — it assumes
   * blocks lapse.
   */
  offerable: number;
  /** The same figure with blocks counted as taken. What is genuinely free. */
  genuinelyFree: number;
};

/**
 * Availability is deliberately **all-or-nothing per slot**: a room free for 19
 * of 21 nights contributes zero, because we sell whole stays, not fragments
 * (doc §5.3).
 *
 * The window is per `(property, category)` — a hotel may be relevant for only
 * part of an event. With no window given it is taken from the nights that
 * exist, which is a reporting choice, not a commercial fact (doc §9, question 10).
 */
export function availability(
  nights: NightRecord[],
  window?: { checkIn: Date; checkOut: Date },
): Availability[] {
  const groups = new Map<string, NightRecord[]>();
  for (const night of nights) {
    const list = groups.get(night.categoryId);
    if (list) list.push(night);
    else groups.set(night.categoryId, [night]);
  }

  return [...groups.values()]
    .map((group) => {
      const first = group[0]!;
      const dates = group.map((night) => night.date.getTime());
      const from = window?.checkIn ?? new Date(Math.min(...dates));
      const to = window?.checkOut ?? addDays(new Date(Math.max(...dates)), 1);

      const inWindow = group.filter(
        (night) => night.date >= from && night.date < to,
      );
      const nightKeys = new Set(inWindow.map((night) => dayKey(night.date)));

      const bySlot = new Map<string, NightRecord[]>();
      for (const night of inWindow) {
        const list = bySlot.get(night.slotId);
        if (list) list.push(night);
        else bySlot.set(night.slotId, [night]);
      }

      // A slot only counts if it is free on *every* night of the window, which
      // means it must also have a night on record for every one of them.
      const countWhole = (isFree: (night: NightRecord) => boolean) =>
        [...bySlot.values()].filter(
          (slotNights) =>
            slotNights.length === nightKeys.size &&
            slotNights.every(isFree),
        ).length;

      return {
        propertyId: first.propertyId,
        propertyName: first.propertyName,
        categoryId: first.categoryId,
        categoryName: first.categoryName,
        from,
        to,
        nights: nightKeys.size,
        slots: bySlot.size,
        // "Held" is BOUGHT or OPTION: we cannot offer what we have not secured.
        offerable: countWhole(
          (night) =>
            (night.acquisitionState === "BOUGHT" ||
              night.acquisitionState === "OPTION") &&
            night.salesState !== "SOLD",
        ),
        genuinelyFree: countWhole(
          (night) =>
            (night.acquisitionState === "BOUGHT" ||
              night.acquisitionState === "OPTION") &&
            !isHardHold(night.salesState),
        ),
      };
    })
    .sort(
      (a, b) =>
        a.propertyName.localeCompare(b.propertyName) ||
        a.categoryName.localeCompare(b.categoryName),
    );
}

// ---------------------------------------------------------------------------
// §4.6 — the deadline dashboard
// ---------------------------------------------------------------------------

export type DeadlineGroup = {
  key: string;
  kind: "option" | "block" | "due";
  /** What is at stake, said plainly. */
  headline: string;
  date: Date;
  daysAway: number;
  urgency: DeadlineUrgency;
  propertyId: string;
  propertyName: string;
  categoryName: string;
  clientName: string | null;
  rooms: number;
  nights: number;
  value: Money[];
  severity: Severity;
};

/**
 * Everything expiring, soonest first, grouped by property and client, with the
 * value at stake — the aggregation the legacy calendar reminders used, which is
 * one entry per supplier per expiry date rather than one per row (doc §4.6).
 */
export function deadlines(nights: NightRecord[], today = todayDay()): DeadlineGroup[] {
  const groups = new Map<
    string,
    Omit<DeadlineGroup, "rooms" | "value" | "nights"> & {
      slots: Set<string>;
      purse: Purse;
      nights: number;
    }
  >();

  const record = (
    night: NightRecord,
    kind: DeadlineGroup["kind"],
    date: Date,
    headline: string,
    clientName: string | null,
    severity: Severity,
    cents: number | null,
    currency: string | null,
  ) => {
    const key = `${kind}|${night.propertyId}|${night.categoryId}|${clientName ?? ""}|${dayKey(date)}`;
    let group = groups.get(key);
    if (!group) {
      group = {
        key,
        kind,
        headline,
        date,
        daysAway: daysUntil(date, today),
        urgency: deadlineUrgency(date, today),
        propertyId: night.propertyId,
        propertyName: night.propertyName,
        categoryName: night.categoryName,
        clientName,
        severity,
        slots: new Set<string>(),
        purse: new Purse(),
        nights: 0,
      };
      groups.set(key, group);
    }
    group.slots.add(night.slotId);
    group.nights += 1;
    group.purse.add(cents, currency);
    if (severity > group.severity) group.severity = severity;
  };

  for (const night of nights) {
    const position = positionOf(
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
    );

    if (night.acquisitionState === "OPTION" && night.optionExpiry) {
      if (deadlineUrgency(night.optionExpiry, today) !== "none") {
        const expected = expectedBuyPrice(night);
        record(
          night,
          "option",
          night.optionExpiry,
          "Our option runs out — exercise it, extend it or let it go",
          night.clientName,
          position.severity,
          expected?.cents ?? null,
          expected?.currency ?? null,
        );
      }
    }

    if (night.salesState === "BLOCKED" && night.blockExpiry) {
      if (deadlineUrgency(night.blockExpiry, today) !== "none") {
        record(
          night,
          "block",
          night.blockExpiry,
          "The client's block runs out — chase the decision",
          night.clientName,
          position.severity,
          night.sellPriceCents,
          night.sellCurrency,
        );
      }
    }

    if (isHardHold(night.salesState) && night.dueDate) {
      if (deadlineUrgency(night.dueDate, today) !== "none") {
        record(
          night,
          "due",
          night.dueDate,
          "The client's due date",
          night.clientName,
          position.severity,
          night.sellPriceCents,
          night.sellCurrency,
        );
      }
    }
  }

  return [...groups.values()]
    .map(({ slots, purse, ...group }) => ({
      ...group,
      rooms: slots.size,
      value: purse.total,
    }))
    .sort(
      (a, b) =>
        a.date.getTime() - b.date.getTime() ||
        b.severity - a.severity ||
        a.propertyName.localeCompare(b.propertyName),
    );
}

// ---------------------------------------------------------------------------
// §7 — financials
// ---------------------------------------------------------------------------

export type Financials = {
  committedCost: Money[];
  contractedRevenue: Money[];
  realisedMargin: Money[];
  pipelineMargin: Money[];
  costAtRisk: Money[];
  idleCost: Money[];
  /**
   * Nights where a margin exists but buy and sell are in different currencies,
   * so it cannot be stated without inventing a rate (invariant §4.5.9).
   */
  marginNotComparable: number;
};

export function financials(nights: NightRecord[]): Financials {
  const committedCost = new Purse();
  const contractedRevenue = new Purse();
  const realisedMargin = new Purse();
  const pipelineMargin = new Purse();
  const costAtRisk = new Purse();
  const idleCost = new Purse();
  let marginNotComparable = 0;

  for (const night of nights) {
    if (held(night)) committedCost.add(night.buyPriceCents, night.buyCurrency);
    if (sold(night)) contractedRevenue.add(night.sellPriceCents, night.sellCurrency);

    const hasBoth =
      night.buyPriceCents !== null &&
      night.sellPriceCents !== null &&
      night.buyCurrency &&
      night.sellCurrency;

    if (hasBoth) {
      if (night.buyCurrency !== night.sellCurrency) {
        marginNotComparable += 1;
      } else {
        const margin = night.sellPriceCents! - night.buyPriceCents!;
        // Realised and pipeline margin are never added together (doc §7).
        const purse = held(night) && sold(night) ? realisedMargin : pipelineMargin;
        purse.add(margin, night.sellCurrency);
      }
    }

    // The number that makes short exposure concrete: what it will cost to buy
    // what we have already sold.
    if (sold(night) && !held(night)) {
      const expected = expectedBuyPrice(night);
      if (expected) costAtRisk.add(expected.cents, expected.currency);
    }

    if (held(night) && !hardHold(night)) {
      idleCost.add(night.buyPriceCents, night.buyCurrency);
    }
  }

  return {
    committedCost: committedCost.total,
    contractedRevenue: contractedRevenue.total,
    realisedMargin: realisedMargin.total,
    pipelineMargin: pipelineMargin.total,
    costAtRisk: costAtRisk.total,
    idleCost: idleCost.total,
    marginNotComparable,
  };
}

// ---------------------------------------------------------------------------
// The headline numbers, for the top of a screen
// ---------------------------------------------------------------------------

export type EventSummary = {
  roomNights: number;
  rooms: number;
  bought: number;
  onOption: number;
  sold: number;
  blocked: number;
  /** Nights that *read* as requested: someone is asking and nobody holds them. */
  requested: number;
  /**
   * Nights where a client is asking for something another client already holds.
   * This is the contention §4.3 exists to make measurable — the number that
   * drives the push to acquire more.
   */
  contested: number;
  short: number;
  long: number;
  bySeverity: Record<Severity, number>;
};

export function summarise(nights: NightRecord[], today = todayDay()): EventSummary {
  const slots = new Set<string>();
  const bySeverity: Record<Severity, number> = { 0: 0, 1: 0, 2: 0, 3: 0, 4: 0 };
  let bought = 0;
  let onOption = 0;
  let soldCount = 0;
  let blocked = 0;
  let requested = 0;
  let contested = 0;
  let short = 0;
  let long = 0;

  for (const night of nights) {
    slots.add(night.slotId);
    if (night.acquisitionState === "BOUGHT") bought += 1;
    if (night.acquisitionState === "OPTION") onOption += 1;
    if (night.salesState === "SOLD") soldCount += 1;
    if (night.salesState === "BLOCKED") blocked += 1;
    if (displayedSalesState(night.salesState, night.requestedBy.length) === "REQUESTED") {
      requested += 1;
    }
    if (night.requestedBy.some((client) => client.id !== night.clientId)) {
      contested += 1;
    }
    if (hardHold(night) && !held(night)) short += 1;
    if (held(night) && !hardHold(night)) long += 1;

    const { severity } = positionOf(
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
    );
    bySeverity[severity] += 1;
  }

  return {
    roomNights: nights.length,
    rooms: slots.size,
    bought,
    onOption,
    sold: soldCount,
    blocked,
    requested,
    contested,
    short,
    long,
    bySeverity,
  };
}
