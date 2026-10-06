import type { Prisma, PrismaClient } from "generated/prisma";

/**
 * A room category's event rate (doc §3.9, §3.10): what a night of it costs us
 * during the event's period — the dates on the event's setup page — read, not
 * typed: the buying rate agreed for the event when there is one, otherwise the
 * rates of the quotations for the event whose periods fall in the event's
 * dates, accepted ones before those only received; declined ones never count.
 * It replaced the indicative price, which is no longer entered.
 */

type Db = Prisma.TransactionClient | PrismaClient;

export type EventRate = {
  /** The lowest and highest rate found, per night, in minor units. Equal when there is one rate. */
  minCents: number;
  maxCents: number;
  currency: string;
  from: "agreed" | "quotation";
  /** "Agreed for the event", a quotation's name, or "2 quotations". */
  label: string;
  /** Whether the quoted periods run across every night of the event — not just some. */
  wholeEvent: boolean;
};

/** Event id → category id → its event rate (absent when there is none). */
export async function eventRates(db: Db, where: { propertyIds: string[]; eventId?: string }) {
  const entries = await db.scoutingEntry.findMany({
    where: { propertyId: { in: where.propertyIds }, ...(where.eventId ? { eventId: where.eventId } : {}) },
    select: {
      eventId: true,
      event: { select: { startDate: true, endDate: true } },
      categoryContracts: { where: { ratePerNightCents: { not: null } }, select: { categoryId: true, ratePerNightCents: true, rateCurrency: true } },
      quotations: {
        where: { status: { not: "DECLINED" } },
        select: {
          name: true,
          status: true,
          currency: true,
          lines: { select: { categoryId: true, checkIn: true, checkOut: true, rateCents: true } },
        },
      },
    },
  });

  const result = new Map<string, Map<string, EventRate>>();
  for (const entry of entries) {
    const rates = result.get(entry.eventId) ?? new Map<string, EventRate>();
    result.set(entry.eventId, rates);
    const { startDate, endDate } = entry.event;

    for (const agreed of entry.categoryContracts) {
      rates.set(agreed.categoryId, {
        minCents: agreed.ratePerNightCents!,
        maxCents: agreed.ratePerNightCents!,
        currency: agreed.rateCurrency ?? entry.quotations[0]?.currency ?? "USD",
        from: "agreed",
        label: "Agreed for the event",
        wholeEvent: true,
      });
    }

    // Quoted periods that fall in the event's dates, per category.
    const quoted = new Map<string, { name: string; accepted: boolean; currency: string; rateCents: number; checkIn: Date; checkOut: Date }[]>();
    for (const quotation of entry.quotations) {
      for (const line of quotation.lines) {
        if (line.checkIn > endDate || line.checkOut <= startDate) continue;
        const list = quoted.get(line.categoryId) ?? [];
        list.push({ name: quotation.name, accepted: quotation.status === "ACCEPTED", currency: quotation.currency, ...line });
        quoted.set(line.categoryId, list);
      }
    }
    for (const [categoryId, all] of quoted) {
      if (rates.has(categoryId)) continue; // An agreed rate says it all.
      const accepted = all.filter((line) => line.accepted);
      const lines = (accepted.length ? accepted : all).filter((line, _, list) => line.currency === list[0]!.currency);
      const names = [...new Set(lines.map((line) => line.name))];
      rates.set(categoryId, {
        minCents: Math.min(...lines.map((line) => line.rateCents)),
        maxCents: Math.max(...lines.map((line) => line.rateCents)),
        currency: lines[0]!.currency,
        from: "quotation",
        label: names.length === 1 ? names[0]! : `${names.length} quotations`,
        wholeEvent: covers(lines, startDate, endDate),
      });
    }
  }
  return result;
}

/** Whether the periods together run from the event's first day to its last, with no gap. */
function covers(lines: { checkIn: Date; checkOut: Date }[], start: Date, end: Date) {
  let reached = start.getTime();
  for (const line of [...lines].sort((a, b) => a.checkIn.getTime() - b.checkIn.getTime())) {
    if (line.checkIn.getTime() > reached) return false;
    reached = Math.max(reached, line.checkOut.getTime());
    if (reached >= end.getTime()) return true;
  }
  return reached >= end.getTime();
}
