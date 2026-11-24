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

/**
 * Whether a room's guests share one bed — a couple in a King — rather than
 * sharing the room in beds of their own (a Double Queen, a Twin, an
 * apartment). The owner, 2026-11-23: "when it's a double room it should have
 * sharing with; when it's a King, leave only one name, but a plus for a
 * partner". Read from the bed configuration ("1 King", "2 Twin"), else the
 * room's name; a room sleeping one never has a partner.
 */
export function sharesOneBed(room: { category: string; bedConfiguration?: string | null; capacity: number; bedrooms?: number | null }) {
  if (room.capacity < 2) return false;
  if (room.bedrooms && room.bedrooms > 1) return false;
  const beds = room.bedConfiguration?.trim().toLowerCase();
  if (beds) {
    const counts = [...beds.matchAll(/(\d+)\s*[x×]?\s*[a-z]/g)].map((m) => Number(m[1]));
    if (counts.length) return counts.reduce((sum, n) => sum + n, 0) === 1;
    if (/\b(twin|two|double queen|double double|queens|doubles)\b/.test(beds)) return false;
    if (/\b(king|queen|matrimonial)\b/.test(beds)) return true;
  }
  // By name, as the owner put it: a "double" is two people sharing; a King (or a single Queen) is a couple's bed.
  const name = room.category.toLowerCase();
  if (/\b(double|twin|two|2 |queen queen|bunk|triple|quad|family|suite|apartment|studio|bedroom)\b/.test(name)) return false;
  return /\b(king|queen|matrimonial)\b/.test(name);
}

/** A stay in a submitted rooming list (doc §6.9): with its property and room in words, as they were then. */
export type SubmittedStay = StaySnapshot & { propertyId: string; property: string; room: string; slotNumber: number };

export type ListChange = { kind: "new" | "changed" | "removed"; property: string; room: string; guests: string; dates: string; detail: string[] };

/**
 * What changed between two submissions of a client's list — or between the
 * last one and the list now: stays added, changed (and how), taken out.
 * Nothing before means everything is new.
 */
export function listChanges(before: SubmittedStay[] | null, now: SubmittedStay[]): ListChange[] {
  const was = new Map((before ?? []).map((stay) => [stay.stayId, stay]));
  const rooms = new Map([...(before ?? []), ...now].map((stay) => [stay.slotId, stay.room]));
  const label = (slotId: string) => rooms.get(slotId) ?? "another room";
  const names = (stay: SubmittedStay) => stay.guests.map(guestName).filter(Boolean).join(", ") || "Nobody named";
  const dates = (stay: SubmittedStay) => formatRange(parseDay(stay.checkIn), parseDay(stay.checkOut));
  const order = (a: SubmittedStay, b: SubmittedStay) => a.property.localeCompare(b.property) || a.slotNumber - b.slotNumber || a.checkIn.localeCompare(b.checkIn);
  const out: ListChange[] = [];
  for (const stay of [...now].sort(order)) {
    const earlier = was.get(stay.stayId);
    const base = { property: stay.property, room: stay.room, guests: names(stay), dates: dates(stay) };
    if (!earlier) out.push({ kind: "new", ...base, detail: [] });
    else {
      const detail = stayChanges(earlier, stay, label);
      if (detail.length) out.push({ kind: "changed", ...base, detail });
    }
  }
  const still = new Set(now.map((stay) => stay.stayId));
  for (const stay of [...(before ?? [])].sort(order)) {
    if (!still.has(stay.stayId)) out.push({ kind: "removed", property: stay.property, room: stay.room, guests: names(stay), dates: dates(stay), detail: [] });
  }
  return out;
}

/** "3 new, 1 changed, 1 taken out" — or "no changes". */
export function changeCount(changes: ListChange[]) {
  const count = (kind: ListChange["kind"]) => changes.filter((change) => change.kind === kind).length;
  const parts = [count("new") && `${count("new")} new`, count("changed") && `${count("changed")} changed`, count("removed") && `${count("removed")} taken out`].filter(Boolean);
  return parts.length ? parts.join(", ") : "no changes";
}
