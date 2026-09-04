import type { LedgerAxis, Prisma } from "generated/prisma";

import type { NightRecord } from "~/lib/stay-rows";
import type { InventoryAction } from "~/lib/inventory";

/**
 * How a room-night is loaded and flattened. Every derived view — the stock
 * sheet, the position grid, the exposure report — works on the same shape, so
 * none of them can disagree about what a night is.
 */

/** Everything the stock sheet and the position grid need about a night. */
export const nightInclude = {
  client: { select: { id: true, name: true, shortName: true } },
  acquisitionOwner: { select: { name: true, email: true } },
  salesOwner: { select: { name: true, email: true } },
  requests: {
    include: { client: { select: { id: true, name: true, shortName: true } } },
  },
  slot: {
    include: {
      category: {
        include: { property: { select: { id: true, name: true } } },
      },
    },
  },
} as const;

export type LoadedNight = Prisma.RoomNightGetPayload<{ include: typeof nightInclude }>;

const person = (user: { name: string | null; email: string | null } | null) =>
  user?.name ?? user?.email ?? null;

const clientLabel = (client: { name: string; shortName: string | null } | null) =>
  client ? (client.shortName ?? client.name) : null;

/** The database row, flattened into the shape the derived views work on. */
export function flatten(night: LoadedNight): NightRecord {
  return {
    id: night.id,
    date: night.date,

    slotId: night.slotId,
    slotNumber: night.slot.slotNumber,
    categoryId: night.slot.categoryId,
    categoryName: night.slot.category.name,
    categorySortOrder: night.slot.category.sortOrder,
    indicativePriceCents: night.slot.category.indicativePriceCents,
    indicativeCurrency: night.slot.category.currency,
    propertyId: night.slot.category.property.id,
    propertyName: night.slot.category.property.name,

    acquisitionState: night.acquisitionState,
    supplierRef: night.supplierRef,
    optionExpiry: night.optionExpiry,
    buyPriceCents: night.buyPriceCents,
    buyCurrency: night.buyCurrency,
    acquisitionOwner: person(night.acquisitionOwner),

    salesState: night.salesState,
    clientId: night.clientId,
    clientName: clientLabel(night.client),
    clientRef: night.clientRef,
    blockExpiry: night.blockExpiry,
    dueDate: night.dueDate,
    sellPriceCents: night.sellPriceCents,
    sellCurrency: night.sellCurrency,
    salesOwner: person(night.salesOwner),

    requestedBy: night.requests.map((request) => ({
      id: request.clientId,
      name: clientLabel(request.client) ?? "Unknown client",
    })),
  };
}

/** "Hotel Carmel · King Room #5" — how a room is named to a human. */
export const describeRoom = (night: LoadedNight) =>
  `${night.slot.category.property.name} · ${night.slot.category.name} #${night.slot.slotNumber}`;


/**
 * Which side of the business an action belongs to. Attribute-only actions
 * belong to the axis whose attributes they change — a re-priced buy is a
 * supplier-side event even though no state moved.
 */
export function axisOf(action: InventoryAction): LedgerAxis {
  switch (action) {
    case "REQUEST":
    case "WITHDRAW_REQUEST":
      return "REQUEST";
    case "START_NEGOTIATION":
    case "TAKE_OPTION":
    case "BUY":
    case "ABANDON":
    case "RELEASE":
    case "EXTEND_OPTION":
    case "REPRICE_BUY":
    case "REASSIGN_ACQUISITION_OWNER":
      return "ACQUISITION";
    default:
      return "SALES";
  }
}
