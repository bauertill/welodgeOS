import type { AcquisitionState, SalesState } from "generated/prisma";

/**
 * The shape every derived view of a room-night is built from — the stock
 * sheet's date-grid, exposure, availability, the deadline dashboard. Nothing
 * here is stored beyond the underlying `RoomNight` row; this is just that row
 * flattened for reading (doc §2.1).
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
