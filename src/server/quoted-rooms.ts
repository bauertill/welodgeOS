import { TRPCError } from "@trpc/server";
import type { Prisma } from "generated/prisma";

import { dayKey, eachNight, nightsBetween } from "~/lib/dates";
import { formatRange } from "~/lib/format";
import { applyInventoryChange } from "~/server/api/routers/inventory";
import { logAudit } from "~/server/audit";

type QuotedLine = { categoryId: string; rooms: number; checkIn: Date; checkOut: Date; category: { name: string; unitCount: number } };

/**
 * Where a quotation asks for more rooms of a room type than the hotel has on
 * the system (doc §3.10, the owner 2026-11-11: room types are often loaded
 * short, or not at all, before the quote comes in). Lines of one room type
 * that overlap add up; lines for different periods do not — the busiest night
 * is what counts.
 */
export function roomShortfall(lines: QuotedLine[]) {
  const busiest = new Map<string, { name: string; has: number; quoted: number }>();
  const byCategory = new Map<string, QuotedLine[]>();
  for (const line of lines) byCategory.set(line.categoryId, [...(byCategory.get(line.categoryId) ?? []), line]);
  for (const [categoryId, own] of byCategory) {
    const perNight = new Map<string, number>();
    for (const line of own) for (const night of eachNight(line.checkIn, line.checkOut)) perNight.set(dayKey(night), (perNight.get(dayKey(night)) ?? 0) + line.rooms);
    const quoted = Math.max(0, ...perNight.values());
    const has = own[0]!.category.unitCount;
    if (quoted > has) busiest.set(categoryId, { name: own[0]!.category.name, has, quoted });
  }
  return [...busiest.entries()].map(([categoryId, numbers]) => ({ categoryId, ...numbers }));
}

/** Raise each short room type to what the quotation asks for, recorded on the property (doc §3.10). */
export async function raiseRoomTypes(tx: Prisma.TransactionClient, actorId: string, quotationId: string) {
  const quotation = await tx.quotation.findUniqueOrThrow({
    where: { id: quotationId },
    select: {
      name: true,
      scoutingEntry: { select: { propertyId: true } },
      lines: { select: { categoryId: true, rooms: true, checkIn: true, checkOut: true, category: { select: { name: true, unitCount: true } } } },
    },
  });
  const short = roomShortfall(quotation.lines);
  for (const room of short) {
    await tx.roomCategory.update({ where: { id: room.categoryId }, data: { unitCount: room.quoted } });
  }
  if (short.length) {
    await logAudit(tx, {
      actorId,
      entity: "Property",
      entityId: quotation.scoutingEntry.propertyId,
      summary: `Room types updated from the quotation "${quotation.name}"`,
      changes: short.map((room) => `${room.name}: ${room.has} → ${room.quoted} rooms`).join("\n"),
    });
  }
  return short;
}

/**
 * A quotation accepted is rooms bought (the owner, 2026-11-05, doc §3.10):
 * each of its lines — so many rooms of a room type, for a stay, at a rate —
 * is bought on the event's stock sheet under the quotation's contract, at the
 * quoted rate, through the inventory's own rules, ledger and undo (§4.7).
 *
 * The rooms picked are the lowest-numbered not yet bought for the whole stay;
 * rooms already bought under this contract for the stay count towards the
 * line, so doing it twice buys nothing more. All or nothing: a line whose room
 * type has too few rooms stops it, saying what to change.
 */
export async function buyQuotedRooms(tx: Prisma.TransactionClient, actorId: string, quotationId: string) {
  const quotation = await tx.quotation.findUniqueOrThrow({
    where: { id: quotationId },
    select: {
      name: true,
      currency: true,
      contractId: true,
      scoutingEntry: { select: { eventId: true } },
      lines: { select: { categoryId: true, rooms: true, checkIn: true, checkOut: true, rateCents: true, category: { select: { name: true, unitCount: true } } } },
    },
  });
  if (!quotation.contractId) throw new TRPCError({ code: "BAD_REQUEST", message: "The quotation has no contract yet — accept it first." });
  const eventId = quotation.scoutingEntry.eventId;
  let bought = 0;
  for (const line of quotation.lines) {
    const stay = { gte: line.checkIn, lt: line.checkOut };
    await tx.roomSlot.createMany({
      data: Array.from({ length: line.category.unitCount }, (_, i) => ({ categoryId: line.categoryId, slotNumber: i + 1 })),
      skipDuplicates: true,
    });
    const slots = await tx.roomSlot.findMany({
      where: { categoryId: line.categoryId, slotNumber: { lte: line.category.unitCount } },
      orderBy: { slotNumber: "asc" },
      select: { id: true, roomNights: { where: { eventId, date: stay }, select: { acquisitionState: true, acquisitionContractId: true } } },
    });
    const nights = nightsBetween(line.checkIn, line.checkOut);
    const done = slots.filter(
      (slot) => slot.roomNights.length === nights && slot.roomNights.every((night) => night.acquisitionState === "BOUGHT" && night.acquisitionContractId === quotation.contractId),
    ).length;
    const needed = line.rooms - done;
    if (needed <= 0) continue;
    const free = slots.filter((slot) => slot.roomNights.every((night) => night.acquisitionState !== "BOUGHT")).slice(0, needed);
    if (free.length < needed) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: `The quote is for ${line.rooms} rooms of ${line.category.name} from ${formatRange(line.checkIn, line.checkOut)}, but only ${done + free.length} of its ${line.category.unitCount} rooms can be bought for the whole stay — raise the room type's number of rooms, or check what is already bought.`,
      });
    }
    const outcome = await applyInventoryChange(tx, actorId, {
      eventId,
      slotIds: free.map((slot) => slot.id),
      checkIn: line.checkIn,
      checkOut: line.checkOut,
      action: "BUY",
      acquisitionContractId: quotation.contractId,
      buyPriceCents: line.rateCents,
      buyCurrency: quotation.currency,
      reason: `Quotation accepted: ${quotation.name}`,
    });
    bought += outcome.nights;
  }
  return { bought };
}
