import { TRPCError } from "@trpc/server";
import type { Prisma } from "generated/prisma";

import { dayKey, eachNight, nightsBetween } from "~/lib/dates";
import { formatRange } from "~/lib/format";
import { percentTaxes, taxName } from "~/lib/taxes";
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

/**
 * A room type marked Contracted takes its rates from the quotation on record
 * (doc §3.9, §3.10 — the team, 2026-11-17): the quotation accepted, or else the
 * only one not declined that quotes this room type. Several and none accepted
 * is a choice for a person — nothing is guessed, and the board says so.
 *
 * What it fills, and only where nothing is set yet:
 *   - the room type's buying rate on this event, with what the rate includes,
 *     the TOT and the period, as on the Properties tab;
 *   - the price of the nights already **bought** on the stock sheet for this
 *     room type within the quoted periods — through the inventory's own
 *     "change the buy price", so each change is in the ledger and can be undone.
 * Nothing is bought here: buying stays a decision (accept the quotation, or
 * buy on the stock sheet).
 */
export async function carryQuotedRates(
  tx: Prisma.TransactionClient,
  actorId: string,
  scoutingEntryId: string,
  categoryIds: string[] | null,
): Promise<{ carried: string[]; undecided: string[] }> {
  const entry = await tx.scoutingEntry.findUniqueOrThrow({
    where: { id: scoutingEntryId },
    select: {
      eventId: true,
      categoryContracts: true,
      quotations: {
        where: { status: { not: "DECLINED" } },
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          name: true,
          status: true,
          currency: true,
          rateIncludes: true,
          rateIncludesOther: true,
          cleaning: true,
          cleaningOther: true,
          taxes: { orderBy: { position: "asc" }, select: { kind: true, label: true, basisPoints: true, amountCents: true } },
          otherTaxes: true,
          lines: { select: { categoryId: true, checkIn: true, checkOut: true, rooms: true, rateCents: true, category: { select: { name: true } } } },
        },
      },
    },
  });
  const quotedCategories = [...new Set(entry.quotations.flatMap((quotation) => quotation.lines.map((line) => line.categoryId)))];
  const carried: string[] = [];
  const undecided: string[] = [];
  for (const categoryId of categoryIds ?? quotedCategories) {
    const covering = entry.quotations.filter((quotation) => quotation.lines.some((line) => line.categoryId === categoryId));
    if (covering.length === 0) continue;
    const accepted = covering.filter((quotation) => quotation.status === "ACCEPTED");
    const quotation = accepted[0] ?? (covering.length === 1 ? covering[0]! : null);
    const name = covering[0]!.lines.find((line) => line.categoryId === categoryId)!.category.name;
    if (!quotation) {
      undecided.push(name);
      continue;
    }
    const lines = quotation.lines.filter((line) => line.categoryId === categoryId).sort((a, b) => a.checkIn.getTime() - b.checkIn.getTime());
    const done: string[] = [];

    // The buying rate on this event, when none is set: the rate of the line
    // with the most room-nights, every line's period and rate in words.
    const contract = entry.categoryContracts.find((row) => row.categoryId === categoryId);
    if (contract?.ratePerNightCents == null) {
      const main = lines.reduce((most, line) =>
        nightsBetween(line.checkIn, line.checkOut) * line.rooms > nightsBetween(most.checkIn, most.checkOut) * most.rooms ? line : most,
      );
      const money = (cents: number) => `${quotation.currency} ${(cents / 100).toFixed(2)}`;
      const period = lines.map((line) => `${formatRange(line.checkIn, line.checkOut)}${lines.length > 1 ? `: ${money(line.rateCents)}` : ""}`).join("; ");
      const data = {
        ratePerNightCents: main.rateCents,
        rateCurrency: quotation.currency,
        rateIncludes: quotation.rateIncludes,
        rateIncludesOther: quotation.rateIncludesOther,
        cleaning: quotation.cleaning,
        cleaningOther: quotation.cleaningOther,
        // A room type keeps one TOT figure: the quoted percentages together; the fixed amounts, in words (doc §3.9).
        totBasisPoints: percentTaxes(quotation.taxes),
        otherTaxes:
          [
            ...quotation.taxes.filter((tax) => tax.amountCents !== null).map((tax) => `${taxName(tax)}: ${money(tax.amountCents!)} per room per night`),
            quotation.otherTaxes,
          ]
            .filter(Boolean)
            .join("; ") || null,
        applicablePeriod: contract?.applicablePeriod ?? period,
      };
      await tx.categoryContract.upsert({
        where: { scoutingEntryId_categoryId: { scoutingEntryId, categoryId } },
        update: data,
        create: { scoutingEntryId, categoryId, ...data },
      });
      done.push(`buying rate ${money(main.rateCents)}`);
    }

    // Nights already bought without a price, each priced at its line's rate.
    let priced = 0;
    for (const line of lines) {
      const nights = await tx.roomNight.findMany({
        where: {
          eventId: entry.eventId,
          slot: { categoryId },
          date: { gte: line.checkIn, lt: line.checkOut },
          acquisitionState: "BOUGHT",
          buyPriceCents: null,
        },
        orderBy: [{ slotId: "asc" }, { date: "asc" }],
        select: { slotId: true, date: true },
      });
      // One change per run of consecutive nights in one room.
      const runs: { slotId: string; from: Date; to: Date }[] = [];
      for (const night of nights) {
        const last = runs.at(-1);
        const next = new Date(night.date.getTime() + 86_400_000);
        if (last && last.slotId === night.slotId && last.to.getTime() === night.date.getTime()) last.to = next;
        else runs.push({ slotId: night.slotId, from: night.date, to: next });
      }
      for (const run of runs) {
        const outcome = await applyInventoryChange(tx, actorId, {
          eventId: entry.eventId,
          slotIds: [run.slotId],
          checkIn: run.from,
          checkOut: run.to,
          action: "REPRICE_BUY",
          buyPriceCents: line.rateCents,
          buyCurrency: quotation.currency,
          reason: `Rate from the quotation "${quotation.name}"`,
        });
        priced += outcome.nights;
      }
    }
    if (priced) done.push(`${priced} bought ${priced === 1 ? "night" : "nights"} priced`);
    if (done.length) carried.push(`${name} — ${done.join(", ")} (from "${quotation.name}")`);
  }
  if (carried.length) {
    await logAudit(tx, { actorId, entity: "ScoutingEntry", entityId: scoutingEntryId, summary: "Rates carried from the quotation", changes: carried.join("\n") });
  }
  return { carried, undecided };
}
