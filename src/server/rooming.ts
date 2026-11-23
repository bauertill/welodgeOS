import { TRPCError } from "@trpc/server";

import type { Prisma, PrismaClient } from "generated/prisma";

import { dayKey, eachNight } from "~/lib/dates";
import { formatRange } from "~/lib/format";
import { logAudit } from "~/server/audit";

/**
 * The rooming list (doc §6.9, the owner 2026-11-23): a *fixed* list made from
 * what the client bought — every room sold to them at the event, with the
 * dates it is theirs — into which they put their people. A room can be used in
 * turns (several stays, one after another) and shared (several guests in one
 * stay). Dates outside what they bought are refused here; asking for more
 * nights is the next step.
 */

type Db = PrismaClient | Prisma.TransactionClient;
export type Guest = { firstName: string; lastName: string };

const DAY = 864e5;

export function guestsOf(json: unknown): Guest[] {
  if (!Array.isArray(json)) return [];
  return json
    .filter((item): item is Guest => Boolean(item) && typeof item === "object")
    .map((item) => ({ firstName: String(item.firstName ?? "").trim(), lastName: String(item.lastName ?? "").trim() }))
    .filter((guest) => guest.firstName || guest.lastName);
}

export const guestName = (guest: Guest) => [guest.firstName, guest.lastName].filter(Boolean).join(" ");

/** Consecutive nights as stays: [first night, check-out). */
function runs(dates: Date[]) {
  const sorted = [...dates].sort((a, b) => a.getTime() - b.getTime());
  const out: { checkIn: Date; checkOut: Date }[] = [];
  for (const date of sorted) {
    const last = out.at(-1);
    if (last && last.checkOut.getTime() === date.getTime()) last.checkOut = new Date(date.getTime() + DAY);
    else out.push({ checkIn: date, checkOut: new Date(date.getTime() + DAY) });
  }
  return out;
}

/** The request, with the client and event the list is for. */
async function requestOf(db: Db, salesRequestId: string) {
  const request = await db.salesRequest.findUnique({
    where: { id: salesRequestId },
    select: { id: true, clientId: true, eventId: true, roomingToken: true, roomingLinkMadeAt: true, client: { select: { name: true } }, event: { select: { id: true, name: true, startDate: true, endDate: true } } },
  });
  if (!request) throw new TRPCError({ code: "NOT_FOUND", message: "That sales request is not there any more." });
  return request;
}

/**
 * The whole list: per property, each room the client bought, its booked
 * dates and its stays — removed ones too for the team, with whether each
 * changed since the property was sent its list.
 */
export async function roomingList(db: Db, salesRequestId: string, { forClient }: { forClient: boolean }) {
  const request = await requestOf(db, salesRequestId);
  if (!request.event) return { request, properties: [] as never[] };
  const [nights, stays, sent] = await Promise.all([
    db.roomNight.findMany({
      where: { eventId: request.event.id, clientId: request.clientId, salesState: "SOLD" },
      select: {
        slotId: true,
        date: true,
        slot: { select: { slotNumber: true, unitNumber: true, category: { select: { id: true, name: true, capacity: true, property: { select: { id: true, name: true, type: true } } } } } },
      },
    }),
    db.roomingStay.findMany({
      where: { salesRequestId, ...(forClient && { removedAt: null }) },
      orderBy: [{ checkIn: "asc" }, { createdAt: "asc" }],
      include: { changedBy: { select: { name: true, email: true } } },
    }),
    db.roomingSent.findMany({ where: { salesRequestId }, include: { sentBy: { select: { name: true, email: true } } } }),
  ]);

  type Room = {
    slotId: string;
    slotNumber: number;
    unitNumber: string | null;
    category: string;
    capacity: number;
    booked: { checkIn: string; checkOut: string }[];
    nights: number;
    named: number;
    stays: {
      id: string;
      checkIn: string;
      checkOut: string;
      guests: Guest[];
      arrival: string | null;
      notes: string | null;
      removed: boolean;
      changedSinceSent: boolean;
      changedBy: string | null;
      updatedAt: Date;
    }[];
  };
  const bySlot = new Map<string, { room: Room; dates: Date[]; propertyId: string; propertyName: string; propertyType: string }>();
  for (const night of nights) {
    const entry =
      bySlot.get(night.slotId) ??
      (() => {
        const created = {
          room: {
            slotId: night.slotId,
            slotNumber: night.slot.slotNumber,
            unitNumber: night.slot.unitNumber,
            category: night.slot.category.name,
            capacity: night.slot.category.capacity,
            booked: [],
            nights: 0,
            named: 0,
            stays: [],
          } as Room,
          dates: [] as Date[],
          propertyId: night.slot.category.property.id,
          propertyName: night.slot.category.property.name,
          propertyType: night.slot.category.property.type,
        };
        bySlot.set(night.slotId, created);
        return created;
      })();
    entry.dates.push(night.date);
  }

  const sentAt = new Map(sent.map((row) => [row.propertyId, row]));
  for (const entry of bySlot.values()) {
    entry.room.booked = runs(entry.dates).map((run) => ({ checkIn: dayKey(run.checkIn), checkOut: dayKey(run.checkOut) }));
    entry.room.nights = entry.dates.length;
    const sold = new Set(entry.dates.map((date) => dayKey(date)));
    const covered = new Set<string>();
    const since = sentAt.get(entry.propertyId)?.sentAt ?? null;
    for (const stay of stays.filter((one) => one.slotId === entry.room.slotId)) {
      if (!stay.removedAt) for (const night of eachNight(stay.checkIn, stay.checkOut)) if (sold.has(dayKey(night))) covered.add(dayKey(night));
      // Removed before the list was sent: nothing to pass on, so not shown.
      if (stay.removedAt && (!since || stay.removedAt <= since || stay.createdAt > since)) continue;
      entry.room.stays.push({
        id: stay.id,
        checkIn: dayKey(stay.checkIn),
        checkOut: dayKey(stay.checkOut),
        guests: guestsOf(stay.guests),
        arrival: stay.arrival,
        notes: stay.notes,
        removed: Boolean(stay.removedAt),
        changedSinceSent: Boolean(since && stay.updatedAt > since),
        changedBy: forClient ? null : stay.changedBy ? (stay.changedBy.name ?? stay.changedBy.email) : "the client",
        updatedAt: stay.updatedAt,
      });
    }
    entry.room.named = covered.size;
  }

  const properties = new Map<string, { id: string; name: string; type: string; sentAt: Date | null; sentBy: string | null; rooms: Room[] }>();
  for (const entry of bySlot.values()) {
    const property =
      properties.get(entry.propertyId) ??
      (() => {
        const row = sentAt.get(entry.propertyId);
        const created = {
          id: entry.propertyId,
          name: entry.propertyName,
          type: entry.propertyType,
          sentAt: forClient ? null : (row?.sentAt ?? null),
          sentBy: forClient || !row?.sentBy ? null : (row.sentBy.name ?? row.sentBy.email),
          rooms: [] as Room[],
        };
        properties.set(entry.propertyId, created);
        return created;
      })();
    property.rooms.push(entry.room);
  }
  const list = [...properties.values()].sort((a, b) => a.name.localeCompare(b.name));
  for (const property of list) property.rooms.sort((a, b) => a.category.localeCompare(b.category) || a.slotNumber - b.slotNumber);
  return { request, properties: list };
}

export type StayInput = { id?: string; slotId: string; checkIn: Date; checkOut: Date; guests: Guest[]; arrival: string; notes: string };

/** Add or change a stay, by the team (actorId) or the client (null), within what was bought. */
export async function saveStay(tx: Prisma.TransactionClient, salesRequestId: string, input: StayInput, actorId: string | null) {
  const request = await requestOf(tx, salesRequestId);
  if (!request.event) throw new TRPCError({ code: "BAD_REQUEST", message: "Choose the event first." });
  const guests = input.guests.map((guest) => ({ firstName: guest.firstName.trim(), lastName: guest.lastName.trim() })).filter((guest) => guest.firstName || guest.lastName);
  if (!guests.length) throw new TRPCError({ code: "BAD_REQUEST", message: "Give at least one guest's name." });
  if (input.checkOut <= input.checkIn) throw new TRPCError({ code: "BAD_REQUEST", message: "Check-out must be after check-in; check-out day is never a night." });

  const slot = await tx.roomSlot.findUnique({ where: { id: input.slotId }, select: { slotNumber: true, unitNumber: true, category: { select: { name: true, capacity: true, property: { select: { name: true } } } } } });
  if (!slot) throw new TRPCError({ code: "NOT_FOUND", message: "That room is not there any more." });
  const sold = await tx.roomNight.findMany({ where: { eventId: request.event.id, clientId: request.clientId, salesState: "SOLD", slotId: input.slotId }, select: { date: true } });
  if (!sold.length) throw new TRPCError({ code: "BAD_REQUEST", message: "That room is not one of yours at this event." });
  const soldDays = new Set(sold.map((night) => dayKey(night.date)));
  if (eachNight(input.checkIn, input.checkOut).some((night) => !soldDays.has(dayKey(night)))) {
    const booked = runs(sold.map((night) => night.date)).map((run) => formatRange(run.checkIn, run.checkOut)).join(", ");
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: `Those dates are outside your booking for this room (${booked}). For other nights, please ask your We Lodge contact.`,
    });
  }
  if (guests.length > slot.category.capacity) {
    throw new TRPCError({ code: "BAD_REQUEST", message: `This room sleeps ${slot.category.capacity}. Put the others in another room.` });
  }
  const clash = await tx.roomingStay.findFirst({
    where: { salesRequestId, slotId: input.slotId, removedAt: null, id: input.id ? { not: input.id } : undefined, checkIn: { lt: input.checkOut }, checkOut: { gt: input.checkIn } },
    select: { checkIn: true, checkOut: true, guests: true },
  });
  if (clash) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: `This room already has ${guestsOf(clash.guests).map(guestName).join(", ") || "guests"} from ${formatRange(clash.checkIn, clash.checkOut)}. Guests sharing go in that stay; otherwise choose other dates or another room.`,
    });
  }

  const data = { checkIn: input.checkIn, checkOut: input.checkOut, guests, arrival: input.arrival.trim() || null, notes: input.notes.trim() || null, changedById: actorId };
  const where = input.id ? await tx.roomingStay.findFirst({ where: { id: input.id, salesRequestId, removedAt: null }, select: { id: true } }) : null;
  if (input.id && !where) throw new TRPCError({ code: "NOT_FOUND", message: "That stay is not there any more." });
  const stay = where ? await tx.roomingStay.update({ where: { id: where.id }, data: { ...data, slotId: input.slotId } }) : await tx.roomingStay.create({ data: { ...data, salesRequestId, slotId: input.slotId } });
  const room = `${slot.category.property.name}, ${slot.category.name} ${slot.unitNumber ? slot.unitNumber : `room ${slot.slotNumber}`}`;
  await logAudit(tx, {
    actorId,
    entity: "SalesRequest",
    entityId: salesRequestId,
    summary: `Rooming list: ${guests.map(guestName).join(", ")} ${where ? "changed" : "added"}${actorId ? "" : " by the client"}`,
    changes: `${room}, ${formatRange(input.checkIn, input.checkOut)}`,
  });
  return stay;
}

export async function removeStay(tx: Prisma.TransactionClient, salesRequestId: string, stayId: string, actorId: string | null) {
  const stay = await tx.roomingStay.findFirst({ where: { id: stayId, salesRequestId, removedAt: null } });
  if (!stay) throw new TRPCError({ code: "NOT_FOUND", message: "That stay is not there any more." });
  await tx.roomingStay.update({ where: { id: stayId }, data: { removedAt: new Date(), changedById: actorId } });
  await logAudit(tx, {
    actorId,
    entity: "SalesRequest",
    entityId: salesRequestId,
    summary: `Rooming list: ${guestsOf(stay.guests).map(guestName).join(", ") || "a stay"} taken out${actorId ? "" : " by the client"}`,
    changes: formatRange(stay.checkIn, stay.checkOut),
  });
}

// --- Importing a client's own rooming list (doc §6.9, the owner 2026-11-23) -------

/** One stay as read from the client's sheet, after its columns were matched. */
export type ImportRow = {
  /** The sheet's row numbers it came from — for pointing at problems. */
  rows: number[];
  guests: Guest[];
  checkIn: string | null;
  checkOut: string | null;
  property: string | null;
  roomType: string | null;
  roomNumber: string | null;
  /** Undefined: the sheet has no such column, so what we have is kept. */
  arrival?: string | null;
  notes?: string | null;
};

const norm = (text: string) => text.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const alike = (a: string, b: string) => {
  const [x, y] = [norm(a), norm(b)];
  return Boolean(x && y) && (x === y || x.includes(y) || y.includes(x));
};
const personKey = (guest: Guest) => norm(guestName(guest));
const covers = (booked: { checkIn: string; checkOut: string }[], checkIn: string, checkOut: string) => booked.some((run) => run.checkIn <= checkIn && run.checkOut >= checkOut);
const overlaps = (a: { checkIn: string; checkOut: string }, b: { checkIn: string; checkOut: string }) => a.checkIn < b.checkOut && b.checkIn < a.checkOut;
const fmt = (from: string, to: string) => formatRange(new Date(`${from}T00:00:00Z`), new Date(`${to}T00:00:00Z`));

/**
 * What a client's sheet would do to the list — nothing is changed. Each stay
 * in the sheet is matched to a guest already on the list (by name) or placed
 * in a free room of the right property, type and number; what cannot be is a
 * problem, saying why (not booked, outside the booking, no room left, too many
 * for the room). Guests on the list but not in the sheet are listed too.
 */
export async function previewImport(db: Db, salesRequestId: string, sheet: ImportRow[]) {
  const { properties } = await roomingList(db, salesRequestId, { forClient: false });
  const rooms = properties.flatMap((property) => property.rooms.map((room) => ({ ...room, property: property.name })));
  const active = rooms.flatMap((room) => room.stays.filter((stay) => !stay.removed).map((stay) => ({ ...stay, slotId: room.slotId })));

  const matched: {
    rows: number[];
    guests: Guest[];
    action: "add" | "update" | "same";
    stayId: string | null;
    slotId: string;
    room: string;
    checkIn: string;
    checkOut: string;
    arrival: string | null;
    notes: string | null;
    changes: string[];
    warning: string | null;
  }[] = [];
  const problems: { rows: number[]; guests: string; message: string }[] = [];
  const usedStays = new Set<string>();
  // Who is in which room on which dates, as the sheet would leave it.
  const taken: { slotId: string; checkIn: string; checkOut: string; stayId: string | null }[] = active.map((stay) => ({ slotId: stay.slotId, checkIn: stay.checkIn, checkOut: stay.checkOut, stayId: stay.id }));
  const label = (room: (typeof rooms)[number]) => `${room.property} · ${room.category} ${room.unitNumber ? `No. ${room.unitNumber}` : `room ${room.slotNumber}`}`;

  for (const row of sheet) {
    const guests = row.guests.filter((guest) => guest.firstName || guest.lastName);
    const who = guests.map(guestName).join(", ") || "(no name)";
    if (!guests.length) {
      problems.push({ rows: row.rows, guests: who, message: "No guest name on this row." });
      continue;
    }
    const keys = new Set(guests.map(personKey));
    const existing = active.find((stay) => !usedStays.has(stay.id) && stay.guests.some((guest) => keys.has(personKey(guest))));

    let candidates = rooms;
    if (row.property) {
      const byProperty = candidates.filter((room) => alike(room.property, row.property!));
      if (!byProperty.length) {
        problems.push({ rows: row.rows, guests: who, message: `No rooms booked at "${row.property}". Booked: ${[...new Set(rooms.map((room) => room.property))].join(", ")}.` });
        continue;
      }
      candidates = byProperty;
    }
    if (row.roomType) {
      const byType = candidates.filter((room) => alike(room.category, row.roomType!));
      if (!byType.length) {
        problems.push({ rows: row.rows, guests: who, message: `No "${row.roomType}" booked${row.property ? ` at ${row.property}` : ""}. Booked: ${[...new Set(candidates.map((room) => room.category))].join(", ")}.` });
        continue;
      }
      candidates = byType;
    }
    let warning: string | null = null;
    if (row.roomNumber) {
      const byNumber = candidates.filter((room) => room.unitNumber && norm(room.unitNumber) === norm(row.roomNumber!));
      if (byNumber.length) candidates = byNumber;
      else warning = `Room number ${row.roomNumber} is not one we know yet — placed by room type.`;
    }

    // Dates: the sheet's, else what the guest has now, else the one stretch these rooms are booked for.
    let checkIn = row.checkIn ?? existing?.checkIn ?? null;
    let checkOut = row.checkOut ?? existing?.checkOut ?? null;
    if (!checkIn || !checkOut) {
      const stretches = [...new Set(candidates.flatMap((room) => room.booked.map((run) => `${run.checkIn}|${run.checkOut}`)))];
      if (stretches.length === 1) [checkIn, checkOut] = stretches[0]!.split("|") as [string, string];
      else {
        problems.push({ rows: row.rows, guests: who, message: "No dates on this row, and these rooms are booked for more than one stretch — add check-in and check-out." });
        continue;
      }
    }
    if (checkOut <= checkIn) {
      problems.push({ rows: row.rows, guests: who, message: `Check-out (${checkOut}) is not after check-in (${checkIn}).` });
      continue;
    }
    const inBooking = candidates.filter((room) => covers(room.booked, checkIn, checkOut));
    if (!inBooking.length) {
      const booked = [...new Set(candidates.flatMap((room) => room.booked.map((run) => fmt(run.checkIn, run.checkOut))))].join(", ");
      problems.push({ rows: row.rows, guests: who, message: `${fmt(checkIn, checkOut)} is outside the booking — these rooms are booked ${booked}.` });
      continue;
    }
    const fits = inBooking.filter((room) => room.capacity >= guests.length);
    if (!fits.length) {
      problems.push({ rows: row.rows, guests: who, message: `${guests.length} guests, but these rooms sleep ${Math.max(...inBooking.map((room) => room.capacity))}.` });
      continue;
    }
    const stay = { checkIn, checkOut };
    const free = (room: (typeof rooms)[number]) => !taken.some((other) => other.slotId === room.slotId && other.stayId !== (existing?.id ?? "-") && overlaps(other, stay));
    const room = (existing && fits.find((one) => one.slotId === existing.slotId && free(one))) ?? fits.find(free);
    if (!room) {
      problems.push({ rows: row.rows, guests: who, message: `No room left: all ${fits.length} matching room${fits.length === 1 ? " is" : "s are"} taken for ${fmt(checkIn, checkOut)}.` });
      continue;
    }

    const arrival = row.arrival === undefined ? (existing?.arrival ?? null) : row.arrival;
    const notes = row.notes === undefined ? (existing?.notes ?? null) : row.notes;
    const changes: string[] = [];
    if (existing) {
      usedStays.add(existing.id);
      const was = existing.guests.map(guestName).join(", ");
      if (norm(was) !== norm(who)) changes.push(`guests ${was} → ${who}`);
      if (existing.checkIn !== checkIn || existing.checkOut !== checkOut) changes.push(`dates ${fmt(existing.checkIn, existing.checkOut)} → ${fmt(checkIn, checkOut)}`);
      if (existing.slotId !== room.slotId) changes.push(`room → ${label(room)}`);
      if ((existing.arrival ?? "") !== (arrival ?? "")) changes.push(`arrival ${existing.arrival ?? "—"} → ${arrival ?? "—"}`);
      if ((existing.notes ?? "") !== (notes ?? "")) changes.push("notes");
      const index = taken.findIndex((other) => other.stayId === existing.id);
      if (index >= 0) taken.splice(index, 1);
    }
    taken.push({ slotId: room.slotId, checkIn, checkOut, stayId: existing?.id ?? null });
    matched.push({ rows: row.rows, guests, action: existing ? (changes.length ? "update" : "same") : "add", stayId: existing?.id ?? null, slotId: room.slotId, room: label(room), checkIn, checkOut, arrival, notes, changes, warning });
  }

  const missing = active
    .filter((stay) => !usedStays.has(stay.id))
    .map((stay) => {
      const room = rooms.find((one) => one.slotId === stay.slotId)!;
      return { stayId: stay.id, guests: stay.guests.map(guestName).join(", "), room: label(room), dates: fmt(stay.checkIn, stay.checkOut) };
    });
  return { matched, problems, missing };
}

/** Make the sheet's changes: each stay added or changed on its own, so one refusal does not stop the rest. */
export async function applyImport(db: PrismaClient, salesRequestId: string, sheet: ImportRow[], removeMissing: boolean, actorId: string | null) {
  const preview = await previewImport(db, salesRequestId, sheet);
  const failed: { guests: string; message: string }[] = [];
  let added = 0;
  let changed = 0;
  let removed = 0;
  if (removeMissing) {
    for (const stay of preview.missing) {
      await db.$transaction((tx) => removeStay(tx, salesRequestId, stay.stayId, actorId));
      removed++;
    }
  }
  for (const item of preview.matched.filter((one) => one.action !== "same")) {
    try {
      await db.$transaction((tx) =>
        saveStay(
          tx,
          salesRequestId,
          { id: item.stayId ?? undefined, slotId: item.slotId, checkIn: new Date(`${item.checkIn}T00:00:00Z`), checkOut: new Date(`${item.checkOut}T00:00:00Z`), guests: item.guests, arrival: item.arrival ?? "", notes: item.notes ?? "" },
          actorId,
        ),
      );
      if (item.action === "add") added++;
      else changed++;
    } catch (error) {
      failed.push({ guests: item.guests.map(guestName).join(", "), message: error instanceof Error ? error.message : "Could not be saved." });
    }
  }
  return { added, changed, removed, failed, problems: preview.problems.length };
}
