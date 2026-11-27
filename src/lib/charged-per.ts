import type { ChargedPer } from "generated/prisma";

import { addDays, nightsBetween } from "~/lib/dates";

/**
 * A quotation line is charged by the night or by the day (doc §3.10, the
 * owner 2026-11-27: meeting rooms and some rooms are sold per day). A night
 * line runs from the first night to check-out day; a day line from the first
 * day to the last day, both counted — 18 Jun to 25 Jul is 37 nights, or 38
 * days. On the stock sheet a day line takes each of its days.
 */
export type Per = ChargedPer;
export const perLabels: Record<Per, string> = { NIGHT: "Per night", DAY: "Per day" };

/** Where the line ends on the stock sheet, closed-open: a day line takes its last day too. */
export function spanEnd(line: { checkOut: Date; per?: Per | null }): Date {
  return line.per === "DAY" ? addDays(line.checkOut, 1) : line.checkOut;
}

/** How many nights, or days, the line is charged for. */
export function unitsOf(line: { checkIn: Date; checkOut: Date; per?: Per | null }): number {
  return nightsBetween(line.checkIn, spanEnd(line));
}

export const unitWord = (per: Per | null | undefined, count: number) => (per === "DAY" ? (count === 1 ? "day" : "days") : count === 1 ? "night" : "nights");

/** "37 room-nights", "38 room-days", or both when a quotation mixes them. */
export function quantityText(roomNights: number, roomDays: number): string {
  return [roomNights || !roomDays ? `${roomNights} room-nights` : null, roomDays ? `${roomDays} room-days` : null].filter(Boolean).join(" · ");
}
