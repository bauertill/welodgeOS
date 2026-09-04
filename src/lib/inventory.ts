import type { AcquisitionState, SalesState } from "generated/prisma";

/**
 * The vocabulary of Phase 2, defined in §10 of docs/product-scope.md and
 * load-bearing: *Bought*, *Option* and *In progress* describe our relationship
 * with the supplier; *Sold*, *Blocked* and *Requested* describe our
 * relationship with the client. They are independent, and there are no
 * synonyms. Every label a user reads comes from here.
 */

export const acquisitionLabels: Record<AcquisitionState, string> = {
  NONE: "Nothing started",
  IN_PROGRESS: "In progress",
  OPTION: "Option",
  BOUGHT: "Bought",
  RELEASED: "Released",
};

export const acquisitionHints: Record<AcquisitionState, string> = {
  NONE: "Known inventory, but no supplier relationship on this night.",
  IN_PROGRESS: "Actively negotiating — yet to be acquired.",
  OPTION: "We hold the right to purchase, until the option expires.",
  BOUGHT: "Acquired under an agreement. This is We Lodge stock.",
  RELEASED: "Previously bought, handed back. Kept for the record; we no longer hold it.",
};

export const acquisitionOrder: AcquisitionState[] = [
  "NONE",
  "IN_PROGRESS",
  "OPTION",
  "BOUGHT",
  "RELEASED",
];

export const salesLabels: Record<SalesState, string> = {
  NONE: "No client",
  REQUESTED: "Requested",
  BLOCKED: "Blocked",
  SOLD: "Sold",
  CANCELLED: "Cancelled",
};

export const salesHints: Record<SalesState, string> = {
  NONE: "No client interest on this night.",
  REQUESTED: "A client would like these nights. Soft and non-exclusive — others may ask too.",
  BLOCKED: "The client holds the right to buy, until the block expires. Exclusive.",
  SOLD: "The client has bought these nights. Exclusive.",
  CANCELLED: "Previously sold, then cancelled. Kept for the record; it no longer counts as sold.",
};

/**
 * The states a hard hold can actually be written in. `REQUESTED` is missing on
 * purpose: a request is a set of soft claims, not a hold (doc §4.3).
 */
export const holdOrder: SalesState[] = ["NONE", "BLOCKED", "SOLD", "CANCELLED"];

/** Whether this state means we are holding the night against the supplier. */
export const isHeld = (state: AcquisitionState) => state === "BOUGHT";

/** Whether this state is an exclusive claim by a client (doc §10, "hard hold"). */
export const isHardHold = (state: SalesState) =>
  state === "BLOCKED" || state === "SOLD";

/**
 * What each bulk action does, in the language the business uses. These are the
 * required bulk actions of §4.8 — the only way inventory ever changes, because
 * on a night grain no meaningful action is single-record.
 */
export const actionLabels = {
  START_NEGOTIATION: "Start negotiating",
  TAKE_OPTION: "Take an option",
  BUY: "Buy",
  ABANDON: "Abandon the negotiation",
  RELEASE: "Release back to the supplier",
  REQUEST: "Record a client request",
  WITHDRAW_REQUEST: "Withdraw a client request",
  BLOCK: "Block for a client",
  SELL: "Sell to a client",
  RELEASE_HOLD: "Release the client's hold",
  CANCEL_SALE: "Cancel the sale",
  EXTEND_OPTION: "Extend the option",
  EXTEND_BLOCK: "Extend the block",
  REPRICE_BUY: "Change the buy price",
  REPRICE_SELL: "Change the sell price",
  REASSIGN_ACQUISITION_OWNER: "Reassign the supplier-side rep",
  REASSIGN_SALES_OWNER: "Reassign the client-side rep",
} as const;

export type InventoryAction = keyof typeof actionLabels;

export const actionHints: Record<InventoryAction, string> = {
  START_NEGOTIATION: "We have opened a conversation with the supplier about these nights.",
  TAKE_OPTION: "The supplier is holding these nights for us until a date we must give.",
  BUY: "We have agreed to take these nights. They become We Lodge stock.",
  ABANDON: "The conversation went nowhere. Back to nothing started.",
  RELEASE: "Hand bought nights back to the supplier. The record is kept.",
  REQUEST: "A client has asked for these nights. Nothing is promised and others may ask too.",
  WITHDRAW_REQUEST: "That client is no longer asking for these nights.",
  BLOCK: "One client holds these nights exclusively until a date we must give.",
  SELL: "One client has committed to these nights.",
  RELEASE_HOLD: "The client's block or sale is lifted and the nights are free again.",
  CANCEL_SALE: "The sale is cancelled. The record is kept and the nights stop counting as sold.",
  EXTEND_OPTION: "Push out the date the supplier's option runs to.",
  EXTEND_BLOCK: "Push out the date the client's block runs to.",
  REPRICE_BUY: "Change what we pay the supplier per night.",
  REPRICE_SELL: "Change what the client pays us per night.",
  REASSIGN_ACQUISITION_OWNER: "Change who is accountable for chasing the supplier.",
  REASSIGN_SALES_OWNER: "Change who is accountable for the client.",
};

/** The acquisition state each acquisition action moves nights into. */
export const acquisitionTarget: Partial<
  Record<InventoryAction, AcquisitionState>
> = {
  START_NEGOTIATION: "IN_PROGRESS",
  TAKE_OPTION: "OPTION",
  BUY: "BOUGHT",
  ABANDON: "NONE",
  RELEASE: "RELEASED",
};

/** The hold state each sales action moves nights into. */
export const salesTarget: Partial<Record<InventoryAction, SalesState>> = {
  BLOCK: "BLOCKED",
  SELL: "SOLD",
  RELEASE_HOLD: "NONE",
  CANCEL_SALE: "CANCELLED",
};

/**
 * Which transitions §4.1 and §4.2 allow. A move that is not listed is refused
 * with an explanation rather than written — the state diagrams in the document
 * are the rule, not a picture of one.
 */
export const allowedAcquisitionMoves: Record<
  AcquisitionState,
  AcquisitionState[]
> = {
  NONE: ["IN_PROGRESS"],
  IN_PROGRESS: ["OPTION", "BOUGHT", "NONE"],
  OPTION: ["BOUGHT", "IN_PROGRESS", "NONE"],
  BOUGHT: ["RELEASED"],
  RELEASED: ["IN_PROGRESS"],
};

export const allowedSalesMoves: Record<SalesState, SalesState[]> = {
  NONE: ["BLOCKED", "SOLD"],
  // Never stored on a night; present so the map is total over the enum.
  REQUESTED: ["BLOCKED", "SOLD"],
  BLOCKED: ["SOLD", "NONE"],
  SOLD: ["CANCELLED", "NONE"],
  CANCELLED: ["BLOCKED", "SOLD"],
};
