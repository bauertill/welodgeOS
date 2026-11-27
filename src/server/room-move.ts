import { TRPCError } from "@trpc/server";
import type { Prisma } from "generated/prisma";

import { addDays, dayKey, nightsBetween } from "~/lib/dates";
import { formatDay, formatMoney } from "~/lib/format";
import { applyInventoryChange } from "~/server/api/routers/inventory";
import { logAudit } from "~/server/audit";

type Tx = Prisma.TransactionClient;

/** A room as the team says it: "Standard Apartment 3", "201", or its building number when known. */
export function roomName(slot: { slotNumber: number; unitNumber: string | null; category: { name: string; unitCount: number } }) {
  const base = slot.category.unitCount <= 1 ? slot.category.name : `${slot.category.name} ${slot.slotNumber}`;
  return slot.unitNumber ? `${base} (no. ${slot.unitNumber})` : base;
}

const slotSelect = { id: true, slotNumber: true, unitNumber: true, category: { select: { name: true, unitCount: true, propertyId: true, property: { select: { name: true } } } } } as const;

/**
 * The rooms a booking can move to (the owner, 2026-11-27: "the hotel has
 * changed it to 202–205 — we should be able to change a room number"): every
 * other room at the same property, and whether it is free on every night of
 * the stay — nothing bought, held or sold there, and no guest.
 */
export async function moveTargets(tx: Tx, input: { eventId: string; slotId: string; checkIn: Date; checkOut: Date }) {
  const from = await tx.roomSlot.findUniqueOrThrow({ where: { id: input.slotId }, select: slotSelect });
  const slots = await tx.roomSlot.findMany({
    where: { category: { propertyId: from.category.propertyId }, id: { not: from.id } },
    orderBy: [{ category: { name: "asc" } }, { slotNumber: "asc" }],
    select: {
      ...slotSelect,
      roomNights: {
        where: { eventId: input.eventId, date: { gte: input.checkIn, lt: input.checkOut } },
        select: { acquisitionState: true, salesState: true, _count: { select: { requests: true } } },
      },
      roomingStays: { where: { removedAt: null, checkIn: { lt: input.checkOut }, checkOut: { gt: input.checkIn } }, select: { id: true } },
    },
  });
  return {
    from: { id: from.id, name: roomName(from), property: from.category.property.name },
    rooms: slots
      .filter((slot) => slot.slotNumber <= Math.max(slot.category.unitCount, 1))
      .map((slot) => {
        const used = slot.roomNights.filter((night) => night.acquisitionState !== "NONE" || night.salesState !== "NONE" || night._count.requests > 0).length;
        return { id: slot.id, name: roomName(slot), free: used === 0 && slot.roomingStays.length === 0, usedNights: used };
      }),
  };
}

/**
 * Move a booking to another room at the same property: every night of the
 * stay — bought or not, held or sold, its prices, contracts, client and
 * request — and the rooming list's guests with it. The nights keep their
 * history (they are the same nights, now in the other room). The room moved
 * to has to be free on every one of those nights; nothing is overwritten.
 */
export async function moveRoom(tx: Tx, actorId: string, input: { eventId: string; fromSlotId: string; toSlotId: string; checkIn: Date; checkOut: Date; reason?: string }) {
  const { eventId, checkIn, checkOut } = input;
  if (nightsBetween(checkIn, checkOut) === 0) throw new TRPCError({ code: "BAD_REQUEST", message: "Choose at least one night to move." });
  const [from, to] = await Promise.all([
    tx.roomSlot.findUniqueOrThrow({ where: { id: input.fromSlotId }, select: slotSelect }),
    tx.roomSlot.findUniqueOrThrow({ where: { id: input.toSlotId }, select: slotSelect }),
  ]);
  if (from.category.propertyId !== to.category.propertyId) throw new TRPCError({ code: "BAD_REQUEST", message: "A booking moves to another room at the same property." });
  if (from.id === to.id) throw new TRPCError({ code: "BAD_REQUEST", message: "Choose another room." });
  const range = { eventId, date: { gte: checkIn, lt: checkOut } };
  const moving = await tx.roomNight.findMany({ where: { ...range, slotId: from.id }, select: { id: true, date: true, acquisitionState: true, salesState: true } });
  const busy = moving.filter((night) => night.acquisitionState !== "NONE" || night.salesState !== "NONE");
  if (busy.length === 0) throw new TRPCError({ code: "BAD_REQUEST", message: `${roomName(from)} has nothing booked on those nights — nothing to move.` });
  const there = await tx.roomNight.findMany({
    where: { ...range, slotId: to.id },
    select: { id: true, date: true, acquisitionState: true, salesState: true, _count: { select: { requests: true } } },
  });
  const taken = there.filter((night) => night.acquisitionState !== "NONE" || night.salesState !== "NONE" || night._count.requests > 0);
  if (taken.length) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: `Nothing was moved — ${roomName(to)} is not free on ${taken.length} of those nights (from ${formatDay(taken[0]!.date)}). Move or release what is there first.`,
    });
  }
  const guestsThere = await tx.roomingStay.count({ where: { slotId: to.id, removedAt: null, checkIn: { lt: checkOut }, checkOut: { gt: checkIn } } });
  if (guestsThere) throw new TRPCError({ code: "BAD_REQUEST", message: `Nothing was moved — ${roomName(to)} has guests on the rooming list on those nights.` });

  // The empty nights in the room moved to make way; then the nights move, the same rows.
  if (there.length) await tx.roomNight.deleteMany({ where: { id: { in: there.map((night) => night.id) } } });
  await tx.roomNight.updateMany({ where: { id: { in: moving.map((night) => night.id) } }, data: { slotId: to.id } });

  // The guests on the rooming list in those nights go with the room.
  const stays = await tx.roomingStay.updateMany({
    where: { slotId: from.id, removedAt: null, checkIn: { gte: checkIn }, checkOut: { lte: addDays(checkOut, 0) } },
    data: { slotId: to.id },
  });

  const period = `${formatDay(checkIn)} – ${formatDay(checkOut)}`;
  const summary = `Moved ${roomName(from)} → ${roomName(to)} at ${from.category.property.name}, ${period} — ${busy.length} ${busy.length === 1 ? "night" : "nights"}${stays.count ? `, ${stays.count} rooming list ${stays.count === 1 ? "stay" : "stays"}` : ""}.`;
  await tx.ledgerEntry.create({
    data: {
      eventId,
      actorId,
      axis: "INVENTORY",
      nightCount: moving.length,
      summary,
      reason: input.reason?.trim() || null,
      undoable: false,
      nights: { connect: moving.map((night) => ({ id: night.id })) },
    },
  });
  await logAudit(tx, { actorId, entity: "Property", entityId: from.category.propertyId, summary, changes: input.reason?.trim() || null });
  return { moved: busy.length, stays: stays.count, summary };
}

/**
 * A supplier contract and the stock sheet (the owner, 2026-11-27: "Megan
 * loaded the provider's contract, yet the inventory still shows it's not
 * contracted — the system needs to match a contract to the room nights"):
 * the hotel's nights on the contract's event — those bought under this
 * contract, and those not bought yet, room by room, as runs of dates — with
 * the rooms the contract's own words name ("Apartments 202, 203, 204 and
 * 205") picked out, so they can be bought under it in one step.
 */
export async function contractStock(tx: Tx, contractId: string) {
  const contract = await tx.contract.findUniqueOrThrow({
    where: { id: contractId },
    select: { id: true, party: true, name: true, notes: true, eventId: true, propertyId: true, currency: true, totalCents: true },
  });
  if (contract.party !== "SUPPLIER" || !contract.eventId || !contract.propertyId) return null;
  const slots = await tx.roomSlot.findMany({
    where: { category: { propertyId: contract.propertyId } },
    orderBy: [{ category: { name: "asc" } }, { slotNumber: "asc" }],
    select: {
      ...slotSelect,
      roomNights: {
        where: { eventId: contract.eventId },
        orderBy: { date: "asc" },
        select: { date: true, acquisitionState: true, acquisitionContractId: true, salesState: true, client: { select: { name: true } } },
      },
    },
  });
  const words = `${contract.name} ${contract.notes ?? ""}`;
  const named = (slot: (typeof slots)[number]) => {
    const tokens = [slot.unitNumber, slot.category.unitCount <= 1 ? slot.category.name : null].filter((one): one is string => Boolean(one?.trim()));
    return tokens.some((token) => new RegExp(`(^|[^0-9A-Za-z])${token.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^0-9A-Za-z]|$)`, "i").test(words));
  };
  let boughtHere = 0;
  const rooms = slots
    .filter((slot) => slot.slotNumber <= Math.max(slot.category.unitCount, 1))
    .map((slot) => {
      const mine = slot.roomNights.filter((night) => night.acquisitionState === "BOUGHT" && night.acquisitionContractId === contract.id);
      boughtHere += mine.length;
      // Not bought: nights with something on them — held or sold to a client, or in progress with the hotel.
      const open = slot.roomNights.filter((night) => night.acquisitionState !== "BOUGHT" && (night.salesState !== "NONE" || night.acquisitionState !== "NONE"));
      const runs: { from: string; to: string; nights: number; client: string | null; sold: boolean }[] = [];
      for (const night of open) {
        const last = runs.at(-1);
        const day = dayKey(night.date);
        if (last && last.to === day && last.client === (night.client?.name ?? null)) {
          last.to = dayKey(addDays(night.date, 1));
          last.nights += 1;
          last.sold ||= night.salesState === "SOLD";
        } else runs.push({ from: day, to: dayKey(addDays(night.date, 1)), nights: 1, client: night.client?.name ?? null, sold: night.salesState === "SOLD" });
      }
      const otherContract = slot.roomNights.filter((night) => night.acquisitionState === "BOUGHT" && night.acquisitionContractId !== contract.id).length;
      return { id: slot.id, name: roomName(slot), named: named(slot), boughtHere: mine.length, boughtElsewhere: otherContract, open: runs };
    });
  const openNights = rooms.reduce((sum, room) => sum + room.open.reduce((s, run) => s + run.nights, 0), 0);
  // A price to start from: the contract's total over the nights of the rooms it names, when that divides evenly.
  const namedOpen = rooms.filter((room) => room.named).reduce((sum, room) => sum + room.open.reduce((s, run) => s + run.nights, 0), 0);
  const suggestedCents = contract.totalCents && namedOpen && contract.totalCents % namedOpen === 0 ? contract.totalCents / namedOpen : null;
  return { contractId: contract.id, eventId: contract.eventId, currency: contract.currency ?? "USD", boughtHere, openNights, rooms, suggestedCents };
}

/** Buy rooms on the stock sheet under a supplier contract, through the inventory's own rules and ledger (doc §4.8). */
export async function buyForContract(
  tx: Tx,
  actorId: string,
  input: { contractId: string; slotIds: string[]; checkIn: Date; checkOut: Date; buyPriceCents: number | null; reason?: string },
) {
  const contract = await tx.contract.findUniqueOrThrow({ where: { id: input.contractId }, select: { party: true, eventId: true, propertyId: true, currency: true, name: true } });
  if (contract.party !== "SUPPLIER" || !contract.eventId || !contract.propertyId) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "Only a hotel's contract on an event buys rooms on its stock sheet." });
  }
  const own = await tx.roomSlot.count({ where: { id: { in: input.slotIds }, category: { propertyId: contract.propertyId } } });
  if (own !== input.slotIds.length) throw new TRPCError({ code: "BAD_REQUEST", message: "Every room has to be at the contract's property." });
  const outcome = await applyInventoryChange(tx, actorId, {
    eventId: contract.eventId,
    slotIds: input.slotIds,
    checkIn: input.checkIn,
    checkOut: input.checkOut,
    action: "BUY",
    acquisitionContractId: input.contractId,
    ...(input.buyPriceCents !== null && { buyPriceCents: input.buyPriceCents, buyCurrency: contract.currency ?? "USD" }),
    reason: input.reason?.trim() || `Under the contract "${contract.name}"`,
  });
  await logAudit(tx, {
    actorId,
    entity: "Contract",
    entityId: input.contractId,
    summary: `${outcome.nights} room-nights bought on the stock sheet under this contract${input.buyPriceCents !== null ? ` at ${formatMoney(input.buyPriceCents, contract.currency ?? "USD")}` : ""}`,
  });
  return outcome;
}
