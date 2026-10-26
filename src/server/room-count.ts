import { TRPCError } from "@trpc/server";
import type { Prisma } from "generated/prisma";

/**
 * Lowering a room type's number of rooms (doc §3.6, §4.5.3; Ami's feedback,
 * 2026-10-25). The rooms above the new count go — unless something is on
 * them: bought, on option or being negotiated with the hotel, blocked or sold
 * to a client, or requested. Empty rooms are just rows on the sheet: their
 * nights are removed with them (the ledger's entries stay, each with its own
 * account of what happened). A room in use is named, with what holds it.
 */
export async function trimRooms(tx: Prisma.TransactionClient, categoryId: string, unitCount: number, categoryName: string) {
  const above = await tx.roomSlot.findMany({
    where: { categoryId, slotNumber: { gt: unitCount } },
    orderBy: { slotNumber: "asc" },
    select: {
      id: true,
      slotNumber: true,
      roomNights: {
        where: {
          OR: [
            { acquisitionState: { in: ["IN_PROGRESS", "OPTION", "BOUGHT"] } },
            { salesState: { in: ["BLOCKED", "SOLD"] } },
            { requests: { some: {} } },
          ],
        },
        select: { acquisitionState: true, salesState: true, _count: { select: { requests: true } } },
      },
    },
  });
  const inUse = above.filter((slot) => slot.roomNights.length > 0);
  if (inUse.length) {
    const what = (slot: (typeof inUse)[number]) => {
      const states = new Set<string>();
      for (const night of slot.roomNights) {
        if (night.salesState === "SOLD") states.add("sold");
        else if (night.salesState === "BLOCKED") states.add("blocked");
        if (night.acquisitionState === "BOUGHT") states.add("bought");
        else if (night.acquisitionState === "OPTION") states.add("on option");
        else if (night.acquisitionState === "IN_PROGRESS") states.add("being negotiated");
        if (night._count.requests) states.add("requested");
      }
      return `#${slot.slotNumber} (${[...states].join(", ")})`;
    };
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: `"${categoryName}" cannot go down to ${unitCount} ${unitCount === 1 ? "room" : "rooms"}: ${inUse.map(what).join("; ")} — release or move ${inUse.length === 1 ? "it" : "them"} on the inventory sheet first.`,
    });
  }
  const ids = above.map((slot) => slot.id);
  if (!ids.length) return 0;
  await tx.roomNight.deleteMany({ where: { slotId: { in: ids } } });
  await tx.roomSlot.deleteMany({ where: { id: { in: ids } } });
  return ids.length;
}
