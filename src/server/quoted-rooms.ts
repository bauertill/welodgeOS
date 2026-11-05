import { TRPCError } from "@trpc/server";
import type { Prisma } from "generated/prisma";

import { nightsBetween } from "~/lib/dates";
import { formatRange } from "~/lib/format";
import { applyInventoryChange } from "~/server/api/routers/inventory";

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
