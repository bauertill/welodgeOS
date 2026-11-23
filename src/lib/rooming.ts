import { parseDay } from "~/lib/dates";
import { formatRange } from "~/lib/format";

/**
 * The rooming list's vocabulary (doc §6.9), shared by the server, the sheet
 * and the Excel file.
 */

/** Details a client's list can also ask for, per guest — switched on by the team per list. */
export const roomingExtraFields = [
  { key: "gender", label: "Gender", placeholder: "F / M" },
  { key: "nationality", label: "Nationality", placeholder: "e.g. Belgian" },
  { key: "passport", label: "Passport no.", placeholder: "" },
  { key: "email", label: "Email", placeholder: "" },
] as const;

export type RoomingExtraKey = (typeof roomingExtraFields)[number]["key"];
export const isExtraKey = (key: string): key is RoomingExtraKey => roomingExtraFields.some((field) => field.key === key);

export type Guest = { firstName: string; lastName: string } & Partial<Record<RoomingExtraKey, string>>;

export const guestName = (guest: { firstName: string; lastName: string }) => [guest.firstName, guest.lastName].filter(Boolean).join(" ");

/** A stay as kept in a sent version, and as compared with the list now. */
export type StaySnapshot = { stayId: string; slotId: string; checkIn: string; checkOut: string; guests: Guest[]; arrival: string | null; notes: string | null };

/** What changed in a stay since a version, in words — empty when nothing did. */
export function stayChanges(was: StaySnapshot, now: StaySnapshot, roomLabel: (slotId: string) => string) {
  const changes: string[] = [];
  const names = (stay: StaySnapshot) => stay.guests.map(guestName).join(", ");
  if (names(was) !== names(now)) changes.push(`guests: ${names(was)} → ${names(now)}`);
  const dates = (stay: StaySnapshot) => formatRange(parseDay(stay.checkIn), parseDay(stay.checkOut));
  if (was.checkIn !== now.checkIn || was.checkOut !== now.checkOut) changes.push(`dates: ${dates(was)} → ${dates(now)}`);
  if (was.slotId !== now.slotId) changes.push(`room: ${roomLabel(was.slotId)} → ${roomLabel(now.slotId)}`);
  if ((was.arrival ?? "") !== (now.arrival ?? "")) changes.push(`arriving: ${was.arrival ?? "—"} → ${now.arrival ?? "—"}`);
  if ((was.notes ?? "") !== (now.notes ?? "")) changes.push(`notes: ${was.notes ?? "—"} → ${now.notes ?? "—"}`);
  const details = (stay: StaySnapshot) => JSON.stringify(stay.guests.map((guest) => roomingExtraFields.map((field) => guest[field.key] ?? "")));
  if (details(was) !== details(now)) changes.push("guest details");
  return changes;
}
