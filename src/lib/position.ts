import type { AcquisitionState, SalesState } from "generated/prisma";

import { daysUntil, today as todayDay } from "~/lib/dates";
import { formatDay } from "~/lib/format";

/**
 * The position grid (doc §4.4): the pair `(acquisition, sales)` turned into an
 * icon, a sentence and a severity. This is the legacy stock sheet's colour and
 * caption logic expressed once, as data, so every screen — stock sheet,
 * deadline dashboard, exposure report — says the same thing about the same
 * night.
 *
 * Two behaviours are carried over deliberately from the old renderer (§11.4):
 * every cell names the **client** and the **binding deadline**, because that is
 * what a rep needs in order to act; and a soft request reads as a request
 * rather than being folded into "nothing is happening here".
 */

// --- Deadline windows (doc §4.6) -------------------------------------------

/** Inside this many days, a deadline is worth knowing about. */
export const REMINDER_WINDOW_DAYS = 7;
/** Inside this many days, a deadline is urgent. "Default 48 hours." */
export const URGENCY_WINDOW_DAYS = 2;

export type Severity = 0 | 1 | 2 | 3 | 4;

export const severityLabels: Record<Severity, string> = {
  0: "Clear",
  1: "Watch",
  2: "Warning",
  3: "Urgent",
  4: "Critical",
};

export type DeadlineUrgency = "none" | "upcoming" | "urgent" | "expired";

/** Where a single deadline sits against the two windows. */
export function deadlineUrgency(
  date: Date | null | undefined,
  today = todayDay(),
): DeadlineUrgency {
  if (!date) return "none";
  const days = daysUntil(date, today);
  if (days < 0) return "expired";
  if (days <= URGENCY_WINDOW_DAYS) return "urgent";
  if (days <= REMINDER_WINDOW_DAYS) return "upcoming";
  return "none";
}

// --- What the position is computed from ------------------------------------

export type PositionInput = {
  acquisitionState: AcquisitionState;
  optionExpiry: Date | null;
  /** The stored hard hold. Never `REQUESTED` — see the schema. */
  salesState: SalesState;
  blockExpiry: Date | null;
  dueDate: Date | null;
  /** The client holding this night, when there is a hard hold. */
  clientName: string | null;
  /** Clients with a soft request on this night — there may be several (§4.3). */
  requestedBy: string[];
};

export type Position = {
  /** As stored, so `RELEASED` stays visible rather than reading as `NONE`. */
  acquisition: AcquisitionState;
  /** As displayed: the hard hold if there is one, else `REQUESTED`, else as stored (§4.3). */
  sales: SalesState;
  severity: Severity;
  icon: string;
  /** What is true and what to do about it, in one line. */
  headline: string;
  /** The binding deadlines, spelled out. */
  detail: string | null;
  /** Things that need a human: an expiry gone by, a deadline that cannot hold. */
  flags: string[];
};

/**
 * `RELEASED` counts as not held and `CANCELLED` counts as not sold (doc §4.1,
 * §4.2), so both collapse to `NONE` for everything positional. They keep their
 * own labels on screen — the record of what happened is the point of having
 * them.
 */
const effectiveAcquisition = (state: AcquisitionState): AcquisitionState =>
  state === "RELEASED" ? "NONE" : state;

const effectiveSales = (state: SalesState): SalesState =>
  state === "CANCELLED" ? "NONE" : state;

/** The sales state a night *reads* as, which is not always the one stored. */
export function displayedSalesState(
  salesState: SalesState,
  requestCount: number,
): SalesState {
  if (salesState === "BLOCKED" || salesState === "SOLD") return salesState;
  if (requestCount > 0) return "REQUESTED";
  return salesState;
}

/** "CNOSF", "CNOSF and 2 others" — contention, said out loud. */
function nameRequesters(names: string[]): string {
  if (names.length === 0) return "a client";
  if (names.length === 1) return names[0]!;
  return `${names[0]!} and ${names.length - 1} other${names.length > 2 ? "s" : ""}`;
}

/**
 * The grid itself. Rows are the acquisition axis, columns the displayed sales
 * axis; each cell states the action and the deadline, not just the state.
 * Severity here is the *base* — deadlines can only push it up (see below).
 */
const GRID: Record<
  string,
  (client: string) => { icon: string; headline: string; severity: Severity }
> = {
  "BOUGHT/SOLD": (c) => ({
    icon: "✅",
    headline: `Bought and sold to ${c}`,
    severity: 0,
  }),
  "BOUGHT/BLOCKED": (c) => ({
    icon: "🏠",
    headline: `Our stock. Blocked by ${c}`,
    severity: 0,
  }),
  "BOUGHT/REQUESTED": (c) => ({
    icon: "🙋",
    // Still idle stock — a request holds nothing — but somebody is asking,
    // which is the cue to convert it rather than sit on it.
    headline: `Our stock, and ${c} is asking for it`,
    severity: 1,
  }),
  "BOUGHT/NONE": () => ({
    icon: "🏠",
    // Long: bought with nobody on it. It is not wrong, but it is money sitting
    // on the book, so it earns a look rather than a clean bill of health.
    headline: "Our stock, unsold",
    severity: 1,
  }),

  "OPTION/SOLD": (c) => ({
    icon: "🚀",
    headline: `Sold to ${c} — exercise the option`,
    severity: 2,
  }),
  "OPTION/BLOCKED": (c) => ({
    icon: "⚠️",
    headline: `Blocked by ${c} — we only hold an option`,
    severity: 2,
  }),
  "OPTION/REQUESTED": (c) => ({
    icon: "🙋",
    headline: `Requested by ${c} — we only hold an option`,
    severity: 1,
  }),
  "OPTION/NONE": () => ({
    icon: "🕐",
    headline: "Option held, nobody on it",
    severity: 0,
  }),

  "IN_PROGRESS/SOLD": (c) => ({
    icon: "🚀",
    headline: `Sold to ${c} — still negotiating with the supplier`,
    severity: 3,
  }),
  "IN_PROGRESS/BLOCKED": (c) => ({
    icon: "⚠️",
    headline: `Blocked by ${c} — still negotiating with the supplier`,
    severity: 2,
  }),
  "IN_PROGRESS/REQUESTED": (c) => ({
    icon: "🙋",
    headline: `Requested by ${c} — negotiating with the supplier`,
    severity: 1,
  }),
  "IN_PROGRESS/NONE": () => ({
    icon: "⚙️",
    headline: "In progress with the supplier",
    severity: 0,
  }),

  "NONE/SOLD": (c) => ({
    icon: "🚨",
    headline: `Sold to ${c} with nothing secured — acquire urgently`,
    severity: 4,
  }),
  "NONE/BLOCKED": (c) => ({
    icon: "⚠️",
    headline: `Blocked by ${c} with nothing secured`,
    severity: 2,
  }),
  "NONE/REQUESTED": (c) => ({
    icon: "❗",
    headline: `Requested by ${c} — no supply line started`,
    severity: 1,
  }),
  "NONE/NONE": () => ({ icon: "—", headline: "Free", severity: 0 }),
};

const highest = (...values: Severity[]) =>
  values.reduce((a, b) => (b > a ? b : a), 0 as Severity);

/**
 * Everything the interface needs to say about one room-night.
 *
 * Severity is the highest of three things: the grid's base severity, how close
 * the binding deadlines are, and whether the two deadlines can both be honoured.
 * A deadline can only make a position worse, never better.
 */
export function positionOf(
  night: PositionInput,
  today = todayDay(),
): Position {
  const sales = displayedSalesState(night.salesState, night.requestedBy.length);
  const acq = effectiveAcquisition(night.acquisitionState);
  const sale = effectiveSales(sales);

  const clientName =
    sale === "REQUESTED"
      ? nameRequesters(night.requestedBy)
      : (night.clientName ?? "a client");

  const cell = (GRID[`${acq}/${sale}`] ?? GRID["NONE/NONE"]!)(clientName);

  // `RELEASED` collapses to `NONE` for the grid, but "we handed this back" and
  // "nothing ever happened here" are different facts, so the free cell says
  // which one it is.
  if (night.acquisitionState === "RELEASED" && sale === "NONE") {
    cell.icon = "↩️";
    cell.headline = "Released back to the supplier";
  }

  // --- Deadlines --------------------------------------------------------
  //
  // Only the deadlines that actually bind are read: an option expiry means
  // nothing once the night is bought, and a block expiry means nothing once
  // the block has been lifted (doc §4.6).
  const optionDeadline = acq === "OPTION" ? night.optionExpiry : null;
  const blockDeadline = sale === "BLOCKED" ? night.blockExpiry : null;
  // The due date is the client's decision deadline while the hold is still
  // open. SOLD means they already signed — nothing left to chase, so it stops
  // counting as a clock the moment the sale closes (doc §4.2, §4.6).
  const dueDeadline = sale === "BLOCKED" ? night.dueDate : null;

  const flags: string[] = [];
  const detail: string[] = [];
  let deadlineSeverity: Severity = 0;

  const read = (date: Date | null, describe: (when: string) => string, what: string) => {
    if (!date) return;
    const urgency = deadlineUrgency(date, today);
    detail.push(describe(formatDay(date)));
    if (urgency === "expired") {
      // The state is never changed automatically (doc §2.4) — it is flagged and
      // stays in the way until a human extends, converts or releases it.
      flags.push(`${what} expired on ${formatDay(date)}`);
      deadlineSeverity = highest(deadlineSeverity, 2);
    } else if (urgency === "urgent") {
      deadlineSeverity = highest(deadlineSeverity, 2);
    } else if (urgency === "upcoming") {
      deadlineSeverity = highest(deadlineSeverity, 1);
    }
  };

  read(optionDeadline, (w) => `Our option runs to ${w}`, "The option");
  read(
    blockDeadline,
    (w) => `${night.clientName ?? "The client"}'s block runs to ${w}`,
    "The block",
  );
  read(dueDeadline, (w) => `Due ${w}`, "The due date");

  // Invariant §4.5.5 — deadline coherence. If the client's block outlives our
  // option to supply it, we are promising something we may not be able to
  // deliver.
  let coherenceSeverity: Severity = 0;
  if (
    acq === "OPTION" &&
    sale === "BLOCKED" &&
    night.optionExpiry &&
    night.blockExpiry &&
    night.optionExpiry < night.blockExpiry
  ) {
    flags.push(
      `The block runs to ${formatDay(night.blockExpiry)} but our option only runs to ${formatDay(night.optionExpiry)}`,
    );
    coherenceSeverity = 2;
  }

  // A sale resting on an option that is about to lapse is the one case the
  // grid escalates all the way (doc §4.4, severity 4).
  const soldOnALapsingOption: Severity =
    sale === "SOLD" &&
    acq === "OPTION" &&
    ["urgent", "expired"].includes(deadlineUrgency(night.optionExpiry, today))
      ? 4
      : 0;

  return {
    acquisition: night.acquisitionState,
    sales,
    severity: highest(
      cell.severity,
      deadlineSeverity,
      coherenceSeverity,
      soldOnALapsingOption,
    ),
    icon: cell.icon,
    headline: cell.headline,
    detail: detail.length ? detail.join(" · ") : null,
    flags,
  };
}

/** Badge colours, so severity looks the same wherever it is rendered. */
export const severityStyles: Record<Severity, string> = {
  0: "bg-[#12b878]/10 text-[#0d8f5d]",
  1: "bg-ink-50 text-ink-500",
  2: "bg-[#e8a33d]/15 text-[#9a6512]",
  3: "bg-[#db4b68]/10 text-[#c03654]",
  4: "bg-[#c03654] text-white",
};
