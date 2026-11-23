import { TRPCError } from "@trpc/server";

import type { Prisma, PrismaClient } from "generated/prisma";

import { dayKey, eachNight } from "~/lib/dates";
import { formatRange } from "~/lib/format";
import { guestName, roomingExtraFields, stayChanges, type Guest, type StaySnapshot } from "~/lib/rooming";
import { logAudit } from "~/server/audit";
import { HOTEL_CONTACT } from "~/server/hotel-contact";
import { notify } from "~/server/notify";

export { guestName, type Guest };

/**
 * The rooming list (doc §6.9, the owner 2026-11-23): a *fixed* list made from
 * what the client bought — every room sold to them at the event, with the
 * dates it is theirs — into which they put their people. A room can be used in
 * turns (several stays, one after another) and shared (several guests in one
 * stay). Nights asked for beyond the booking are an extension request: the
 * stay is kept, those nights flagged, and acquisitions gets a task to get them.
 */

type Db = PrismaClient | Prisma.TransactionClient;

const DAY = 864e5;

export function guestsOf(json: unknown): Guest[] {
  if (!Array.isArray(json)) return [];
  return json
    .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object")
    .map((item) => {
      const guest: Guest = { firstName: String(item.firstName ?? "").trim(), lastName: String(item.lastName ?? "").trim() };
      for (const field of roomingExtraFields) {
        const value = typeof item[field.key] === "string" ? (item[field.key] as string).trim() : "";
        if (value) guest[field.key] = value;
      }
      return guest;
    })
    .filter((guest) => guest.firstName || guest.lastName);
}

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
    select: {
      id: true,
      clientId: true,
      eventId: true,
      ownerId: true,
      roomingToken: true,
      roomingLinkMadeAt: true,
      roomingFields: true,
      client: { select: { name: true } },
      event: { select: { id: true, name: true, startDate: true, endDate: true } },
    },
  });
  if (!request) throw new TRPCError({ code: "NOT_FOUND", message: "That sales request is not there any more." });
  return request;
}

/**
 * A client's rooming list at an event is one list, whichever of their sales
 * requests it is opened from (doc §6.9): an addendum's link shows the same
 * guests, so nobody is entered twice.
 */
const scopeOf = (request: { clientId: string; eventId: string | null }) => ({ salesRequest: { clientId: request.clientId, eventId: request.eventId } });

export const snapshotOf = (stay: { id: string; slotId: string; checkIn: Date; checkOut: Date; guests: unknown; arrival: string | null; notes: string | null }): StaySnapshot => ({
  stayId: stay.id,
  slotId: stay.slotId,
  checkIn: dayKey(stay.checkIn),
  checkOut: dayKey(stay.checkOut),
  guests: guestsOf(stay.guests),
  arrival: stay.arrival,
  notes: stay.notes,
});

export const snapshotsOf = (json: unknown) => (Array.isArray(json) ? (json as StaySnapshot[]).map((stay) => ({ ...stay, guests: guestsOf(stay.guests) })) : []);

/**
 * The whole list: per property, each room the client bought, its booked
 * dates and its stays — for the team, also those taken out since the last
 * version sent — with what changed since that version, and any nights a stay
 * asks for beyond the booking.
 */
export async function roomingList(db: Db, salesRequestId: string, options: { forClient: boolean; propertyId?: string }) {
  const request = await requestOf(db, salesRequestId);
  if (!request.event) return { request, properties: [] as Awaited<ReturnType<typeof roomingFor>> };
  return { request, properties: await roomingFor(db, { clientId: request.clientId, eventId: request.event.id }, options) };
}

/** One client's list at an event — every property, or one. */
export async function roomingFor(db: Db, scope: { clientId: string; eventId: string }, { forClient, propertyId }: { forClient: boolean; propertyId?: string }) {
  const request = { clientId: scope.clientId, event: { id: scope.eventId } };
  const [nights, stays, versions] = await Promise.all([
    db.roomNight.findMany({
      where: { eventId: request.event.id, clientId: request.clientId, salesState: "SOLD", ...(propertyId && { slot: { category: { propertyId } } }) },
      select: {
        slotId: true,
        date: true,
        slot: { select: { slotNumber: true, unitNumber: true, category: { select: { id: true, name: true, capacity: true, property: { select: { id: true, name: true, type: true, checkInTime: true, checkOutTime: true } } } } } },
      },
    }),
    db.roomingStay.findMany({
      where: { salesRequest: { clientId: scope.clientId, eventId: scope.eventId } },
      orderBy: [{ checkIn: "asc" }, { createdAt: "asc" }],
      include: { changedBy: { select: { name: true, email: true } } },
    }),
    db.roomingVersion.findMany({ where: { eventId: scope.eventId, ...(propertyId && { propertyId }) }, orderBy: { number: "desc" }, include: { sentBy: { select: { name: true, email: true } } } }),
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
      /** New, changed or taken out since the last version sent — and how. */
      sinceSent: "new" | "changed" | "removed" | null;
      changes: string[];
      changedBy: string | null;
      /** Nights asked for beyond the booking, not yet sold to the client. */
      extra: { checkIn: string; checkOut: string }[];
      extraNights: number;
    }[];
  };
  type Entry = { room: Room; dates: Date[]; propertyId: string; propertyName: string; propertyType: string; times: string | null };
  const bySlot = new Map<string, Entry>();
  for (const night of nights) {
    let entry = bySlot.get(night.slotId);
    if (!entry) {
      const property = night.slot.category.property;
      entry = {
        room: { slotId: night.slotId, slotNumber: night.slot.slotNumber, unitNumber: night.slot.unitNumber, category: night.slot.category.name, capacity: night.slot.category.capacity, booked: [], nights: 0, named: 0, stays: [] },
        dates: [],
        propertyId: property.id,
        propertyName: property.name,
        propertyType: property.type,
        times: [property.checkInTime && `check-in from ${property.checkInTime}`, property.checkOutTime && `check-out by ${property.checkOutTime}`].filter(Boolean).join(", ") || null,
      };
      bySlot.set(night.slotId, entry);
    }
    entry.dates.push(night.date);
  }

  const latest = new Map<string, (typeof versions)[number]>();
  for (const version of versions) if (!latest.has(version.propertyId)) latest.set(version.propertyId, version);
  const labelOf = (slotId: string) => {
    const room = bySlot.get(slotId)?.room;
    return room ? `${room.category} ${room.unitNumber ? `No. ${room.unitNumber}` : `room ${room.slotNumber}`}` : "another room";
  };

  for (const entry of bySlot.values()) {
    entry.room.booked = runs(entry.dates).map((run) => ({ checkIn: dayKey(run.checkIn), checkOut: dayKey(run.checkOut) }));
    entry.room.nights = entry.dates.length;
    const sold = new Set(entry.dates.map((date) => dayKey(date)));
    const covered = new Set<string>();
    const version = latest.get(entry.propertyId);
    const sent = new Map(snapshotsOf(version?.stays).map((stay) => [stay.stayId, stay]));
    for (const stay of stays.filter((one) => one.slotId === entry.room.slotId)) {
      const was = sent.get(stay.id);
      if (stay.removedAt) {
        // Taken out: shown to the team only while the property still has it from the last version.
        if (forClient || !was) continue;
      }
      const extraNights: Date[] = [];
      if (!stay.removedAt) {
        for (const night of eachNight(stay.checkIn, stay.checkOut)) {
          if (sold.has(dayKey(night))) covered.add(dayKey(night));
          else extraNights.push(night);
        }
      }
      const now = snapshotOf(stay);
      const changes = version && was && !stay.removedAt ? stayChanges(was, now, labelOf) : [];
      entry.room.stays.push({
        id: stay.id,
        checkIn: now.checkIn,
        checkOut: now.checkOut,
        guests: now.guests,
        arrival: stay.arrival,
        notes: stay.notes,
        removed: Boolean(stay.removedAt),
        // What the hotel has is ours to know, not the client's.
        sinceSent: forClient || !version ? null : stay.removedAt ? "removed" : !was ? "new" : changes.length ? "changed" : null,
        changes: forClient ? [] : changes,
        changedBy: forClient ? null : stay.changedBy ? (stay.changedBy.name ?? stay.changedBy.email) : "the client",
        extra: runs(extraNights).map((run) => ({ checkIn: dayKey(run.checkIn), checkOut: dayKey(run.checkOut) })),
        extraNights: extraNights.length,
      });
    }
    entry.room.named = covered.size;
  }

  type PropertyList = {
    id: string;
    name: string;
    type: string;
    times: string | null;
    /** The last version sent, if any — and every one, for downloading again. */
    sentAt: Date | null;
    sentBy: string | null;
    version: number | null;
    versions: { number: number; sentAt: Date; sentBy: string | null }[];
    rooms: Room[];
  };
  const properties = new Map<string, PropertyList>();
  for (const entry of bySlot.values()) {
    let property = properties.get(entry.propertyId);
    if (!property) {
      const last = latest.get(entry.propertyId);
      property = {
        id: entry.propertyId,
        name: entry.propertyName,
        type: entry.propertyType,
        times: entry.times,
        sentAt: forClient ? null : (last?.sentAt ?? null),
        sentBy: forClient || !last?.sentBy ? null : (last.sentBy.name ?? last.sentBy.email),
        version: forClient ? null : (last?.number ?? null),
        versions: forClient
          ? []
          : versions.filter((one) => one.propertyId === entry.propertyId).map((one) => ({ number: one.number, sentAt: one.sentAt, sentBy: one.sentBy ? (one.sentBy.name ?? one.sentBy.email) : null })),
        rooms: [],
      };
      properties.set(entry.propertyId, property);
    }
    property.rooms.push(entry.room);
  }
  const list = [...properties.values()].sort((a, b) => a.name.localeCompare(b.name));
  for (const property of list) property.rooms.sort((a, b) => a.category.localeCompare(b.category) || a.slotNumber - b.slotNumber);
  return list;
}

export type StayInput = { id?: string; slotId: string; checkIn: Date; checkOut: Date; guests: Guest[]; arrival: string; notes: string };

/** Each guest as kept: the name, and the extra details this list asks for. */
function cleanGuests(guests: Guest[], fields: string[]) {
  return guests
    .map((guest) => {
      const clean: Guest = { firstName: guest.firstName.trim(), lastName: guest.lastName.trim() };
      for (const field of roomingExtraFields) {
        const value = guest[field.key]?.trim();
        if (value && fields.includes(field.key)) clean[field.key] = value.slice(0, 200);
      }
      return clean;
    })
    .filter((guest) => guest.firstName || guest.lastName);
}

/**
 * Add or change a stay, by the team (actorId) or the client (null). Its dates
 * may reach beyond the booking — next to or overlapping it, in a room nobody
 * else holds then: those nights become an extension request.
 */
export async function saveStay(tx: Prisma.TransactionClient, salesRequestId: string, input: StayInput, actorId: string | null) {
  const request = await requestOf(tx, salesRequestId);
  if (!request.event) throw new TRPCError({ code: "BAD_REQUEST", message: "Choose the event first." });
  const guests = cleanGuests(input.guests, request.roomingFields);
  if (!guests.length) throw new TRPCError({ code: "BAD_REQUEST", message: "Give at least one guest's name." });
  if (input.checkOut <= input.checkIn) throw new TRPCError({ code: "BAD_REQUEST", message: "Check-out must be after check-in; check-out day is never a night." });

  const slot = await tx.roomSlot.findUnique({ where: { id: input.slotId }, select: { slotNumber: true, unitNumber: true, category: { select: { name: true, capacity: true, property: { select: { id: true, name: true } } } } } });
  if (!slot) throw new TRPCError({ code: "NOT_FOUND", message: "That room is not there any more." });
  const sold = await tx.roomNight.findMany({ where: { eventId: request.event.id, clientId: request.clientId, salesState: "SOLD", slotId: input.slotId }, select: { date: true } });
  if (!sold.length) throw new TRPCError({ code: "BAD_REQUEST", message: "That room is not one of yours at this event." });
  const soldDays = new Set(sold.map((night) => dayKey(night.date)));
  const booked = runs(sold.map((night) => night.date));
  const bookedText = booked.map((run) => formatRange(run.checkIn, run.checkOut)).join(", ");
  const extra = eachNight(input.checkIn, input.checkOut).filter((night) => !soldDays.has(dayKey(night)));
  if (extra.length) {
    // More nights in this room: only around its booking, not a stay of its own somewhere else.
    if (!booked.some((run) => input.checkIn <= run.checkOut && input.checkOut >= run.checkIn)) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: `Those dates do not touch your booking for this room (${bookedText}). Extra nights can be asked for just before or after it; for other dates, please ask your We Lodge contact.`,
      });
    }
    const held = await tx.roomNight.findFirst({
      where: { slotId: input.slotId, eventId: request.event.id, date: { in: extra }, salesState: { in: ["SOLD", "BLOCKED"] }, clientId: { not: request.clientId } },
      select: { date: true },
    });
    if (held) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: `This room is taken by another booking on ${formatRange(held.date, new Date(held.date.getTime() + DAY))}. Choose another room for those nights, or ask your We Lodge contact.`,
      });
    }
  }
  if (guests.length > slot.category.capacity) {
    throw new TRPCError({ code: "BAD_REQUEST", message: `This room sleeps ${slot.category.capacity}. Put the others in another room.` });
  }
  const clash = await tx.roomingStay.findFirst({
    where: { ...scopeOf(request), slotId: input.slotId, removedAt: null, id: input.id ? { not: input.id } : undefined, checkIn: { lt: input.checkOut }, checkOut: { gt: input.checkIn } },
    select: { checkIn: true, checkOut: true, guests: true },
  });
  if (clash) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: `This room already has ${guestsOf(clash.guests).map(guestName).join(", ") || "guests"} from ${formatRange(clash.checkIn, clash.checkOut)}. Guests sharing go in that stay; otherwise choose other dates or another room.`,
    });
  }

  const before = input.id ? await tx.roomingStay.findFirst({ where: { id: input.id, ...scopeOf(request), removedAt: null } }) : null;
  if (input.id && !before) throw new TRPCError({ code: "NOT_FOUND", message: "That stay is not there any more." });
  const sameExtra = before && before.checkIn.getTime() === input.checkIn.getTime() && before.checkOut.getTime() === input.checkOut.getTime() && before.slotId === input.slotId;
  const data = {
    checkIn: input.checkIn,
    checkOut: input.checkOut,
    guests,
    arrival: input.arrival.trim() || null,
    notes: input.notes.trim() || null,
    changedById: actorId,
    extraAskedAt: extra.length ? (sameExtra && before?.extraAskedAt ? before.extraAskedAt : new Date()) : null,
  };
  const stay = before ? await tx.roomingStay.update({ where: { id: before.id }, data: { ...data, slotId: input.slotId } }) : await tx.roomingStay.create({ data: { ...data, salesRequestId, slotId: input.slotId } });
  const room = `${slot.category.property.name}, ${slot.category.name} ${slot.unitNumber ? slot.unitNumber : `room ${slot.slotNumber}`}`;
  await logAudit(tx, {
    actorId,
    entity: "SalesRequest",
    entityId: salesRequestId,
    summary: `Rooming list: ${guests.map(guestName).join(", ")} ${before ? "changed" : "added"}${actorId ? "" : " by the client"}${extra.length ? ` — asks for ${extra.length} extra night${extra.length === 1 ? "" : "s"}` : ""}`,
    changes: `${room}, ${formatRange(input.checkIn, input.checkOut)}`,
  });
  // The extension task follows what is asked for — made, updated or closed.
  if (extra.length || before?.extraAskedAt) await syncExtensionTask(tx, salesRequestId, slot.category.property.id, actorId);
  if (before && before.slotId !== input.slotId && before.extraAskedAt) {
    const from = await tx.roomSlot.findUnique({ where: { id: before.slotId }, select: { category: { select: { propertyId: true } } } });
    if (from && from.category.propertyId !== slot.category.property.id) await syncExtensionTask(tx, salesRequestId, from.category.propertyId, actorId);
  }
  return stay;
}

export async function removeStay(tx: Prisma.TransactionClient, salesRequestId: string, stayId: string, actorId: string | null) {
  const request = await requestOf(tx, salesRequestId);
  const stay = await tx.roomingStay.findFirst({ where: { id: stayId, ...scopeOf(request), removedAt: null }, include: { slot: { select: { category: { select: { propertyId: true } } } } } });
  if (!stay) throw new TRPCError({ code: "NOT_FOUND", message: "That stay is not there any more." });
  await tx.roomingStay.update({ where: { id: stayId }, data: { removedAt: new Date(), changedById: actorId, extraAskedAt: null } });
  await logAudit(tx, {
    actorId,
    entity: "SalesRequest",
    entityId: salesRequestId,
    summary: `Rooming list: ${guestsOf(stay.guests).map(guestName).join(", ") || "a stay"} taken out${actorId ? "" : " by the client"}`,
    changes: formatRange(stay.checkIn, stay.checkOut),
  });
  if (stay.extraAskedAt) await syncExtensionTask(tx, salesRequestId, stay.slot.category.propertyId, actorId);
}

/**
 * A property's master rooming list as sent now (doc §6.9): the next version,
 * with every client's stays there at the event.
 */
export async function markSent(tx: Prisma.TransactionClient, eventId: string, propertyId: string, actorId: string) {
  const stays = await tx.roomingStay.findMany({
    where: { removedAt: null, salesRequest: { eventId }, slot: { category: { propertyId } } },
    include: { salesRequest: { select: { clientId: true, client: { select: { name: true } } } } },
    orderBy: [{ checkIn: "asc" }],
  });
  const last = await tx.roomingVersion.findFirst({ where: { eventId, propertyId }, orderBy: { number: "desc" }, select: { number: true } });
  const number = (last?.number ?? 0) + 1;
  await tx.roomingVersion.create({
    data: { eventId, propertyId, number, stays: stays.map((stay) => ({ ...snapshotOf(stay), clientId: stay.salesRequest.clientId, client: stay.salesRequest.client.name })), sentById: actorId },
  });
  await logAudit(tx, { actorId, entity: "Property", entityId: propertyId, summary: `Master rooming list V${number} sent to the property`, changes: `${stays.length} stay${stays.length === 1 ? "" : "s"}, ${new Set(stays.map((stay) => stay.salesRequest.clientId)).size} client(s)` });
  return number;
}

// --- Extension requests (doc §6.9, the owner 2026-11-23) ---------------------------

export const EXTENSION = "Extra nights";

/** The extra nights still asked for at a property, per stay, in words. */
async function askedAt(tx: Prisma.TransactionClient, salesRequestId: string, propertyId: string) {
  const request = await requestOf(tx, salesRequestId);
  if (!request.event) return [];
  const stays = await tx.roomingStay.findMany({
    where: { ...scopeOf(request), removedAt: null, extraAskedAt: { not: null }, slot: { category: { propertyId } } },
    include: { slot: { select: { slotNumber: true, unitNumber: true, category: { select: { name: true } } } } },
    orderBy: { checkIn: "asc" },
  });
  const out: { stayId: string; slotId: string; line: string; nights: number }[] = [];
  for (const stay of stays) {
    const sold = await tx.roomNight.findMany({ where: { slotId: stay.slotId, eventId: request.event.id, clientId: request.clientId, salesState: "SOLD", date: { gte: stay.checkIn, lt: stay.checkOut } }, select: { date: true } });
    const soldDays = new Set(sold.map((night) => dayKey(night.date)));
    const extra = eachNight(stay.checkIn, stay.checkOut).filter((night) => !soldDays.has(dayKey(night)));
    if (!extra.length) continue;
    const room = `${stay.slot.category.name} ${stay.slot.unitNumber ? `No. ${stay.slot.unitNumber}` : `room ${stay.slot.slotNumber}`}`;
    out.push({
      stayId: stay.id,
      slotId: stay.slotId,
      nights: extra.length,
      line: `• ${room} — ${runs(extra).map((run) => formatRange(run.checkIn, run.checkOut)).join(", ")} (${extra.length} night${extra.length === 1 ? "" : "s"}) for ${guestsOf(stay.guests).map(guestName).join(", ")}`,
    });
  }
  return out;
}

/**
 * The extension task at a property (one open per request and property): made
 * when extra nights are first asked for, its list kept up to date, and closed
 * — the account manager told — once nothing is asked for any more.
 */
export async function syncExtensionTask(tx: Prisma.TransactionClient, salesRequestId: string, propertyId: string, actorId: string | null, settled = false) {
  const request = await requestOf(tx, salesRequestId);
  if (!request.event) return;
  const asked = await askedAt(tx, salesRequestId, propertyId);
  // One open task per client, event and property — whichever of their requests asked.
  const open = await tx.task.findFirst({ where: { clientId: request.clientId, eventId: request.event.id, propertyId, status: { not: "DONE" }, type: { name: EXTENSION } }, select: { id: true, details: true, assignees: { select: { id: true } } } });
  const property = await tx.property.findUniqueOrThrow({ where: { id: propertyId }, select: { name: true } });
  const details = (lines: string[]) =>
    [`${request.client.name} asks for nights beyond their booking at ${property.name}:`, ...lines, "", "Get these nights from the property and sell them to the client — the rooming list then shows them as booked, and this task closes on its own."].join("\n");

  if (!asked.length) {
    if (!open) return;
    await tx.task.update({ where: { id: open.id }, data: { status: "DONE", doneAt: new Date() } });
    await tx.taskComment.create({ data: { taskId: open.id, authorId: null, body: settled ? "All the extra nights are booked for the client." : "Nothing is asked for any more — the stays were changed or taken out." } });
    await logAudit(tx, { actorId, entity: "Task", entityId: open.id, summary: settled ? "Done — the extra nights are booked" : "Done — no extra nights asked for any more" });
    if (settled) {
      await notify(tx, {
        to: [request.ownerId],
        actorId,
        kind: "TASK_STATUS",
        title: `Extra nights booked: ${property.name} for ${request.client.name}`,
        body: "Let the client know — their rooming list now shows them as booked.",
        link: `/sales/${salesRequestId}#rooming`,
        taskId: open.id,
      });
    }
    return;
  }

  const text = details(asked.map((one) => one.line));
  if (open) {
    if (open.details !== text) {
      await tx.task.update({ where: { id: open.id }, data: { details: text } });
      await tx.taskComment.create({ data: { taskId: open.id, authorId: actorId, body: `What is asked for changed:\n${asked.map((one) => one.line).join("\n")}` } });
    }
    return;
  }

  const type = (await tx.taskType.findFirst({ where: { name: { equals: EXTENSION, mode: "insensitive" } } })) ?? (await tx.taskType.create({ data: { name: EXTENSION } }));
  // Whoever has these rooms with the property, else whoever handled it, else the event's accommodation managers.
  const owners = await tx.roomNight.findMany({ where: { slotId: { in: asked.map((one) => one.slotId) }, eventId: request.event.id, acquisitionOwnerId: { not: null } }, select: { acquisitionOwnerId: true }, distinct: ["acquisitionOwnerId"] });
  let assignees = owners.map((one) => one.acquisitionOwnerId!).filter(Boolean);
  if (!assignees.length) {
    const contact = await tx.task.findFirst({ where: { propertyId, eventId: request.event.id, type: { name: HOTEL_CONTACT } }, orderBy: { createdAt: "desc" }, select: { assignees: { select: { id: true } } } });
    assignees = contact?.assignees.map((person) => person.id) ?? [];
  }
  if (!assignees.length) {
    const event = await tx.event.findUniqueOrThrow({ where: { id: request.event.id }, select: { accommodationManagers: { select: { id: true } } } });
    assignees = event.accommodationManagers.map((person) => person.id);
  }
  if (!assignees.length && request.ownerId) assignees = [request.ownerId];
  const task = await tx.task.create({
    data: {
      title: `Extra nights: ${property.name} for ${request.client.name} — ${request.event.name}`,
      details: text,
      status: "TODO",
      typeId: type.id,
      requestedById: request.ownerId ?? actorId,
      createdById: actorId,
      eventId: request.event.id,
      propertyId,
      clientId: request.clientId,
      salesRequestId,
      assignees: { connect: assignees.map((id) => ({ id })) },
    },
  });
  await logAudit(tx, { actorId, entity: "Task", entityId: task.id, summary: `Task added: ${task.title}`, changes: actorId ? "Made on its own from the rooming list" : "Made on its own when the client asked for extra nights on their rooming list" });
  await notify(tx, {
    to: assignees,
    actorId,
    kind: "TASK_ASSIGNED",
    title: `Extra nights asked for: ${property.name} for ${request.client.name}`,
    body: "The rooming list asks for nights beyond the booking. Get them from the property.",
    link: `/tasks/${task.id}`,
    taskId: task.id,
  });
}

/**
 * Nights were just sold to a client (doc §6.9): any extension of theirs at the
 * event that is now all booked is settled — its flag cleared, its task closed
 * and the account manager told.
 */
export async function settleExtensions(tx: Prisma.TransactionClient, eventId: string, clientId: string, actorId: string) {
  const stays = await tx.roomingStay.findMany({
    where: { removedAt: null, extraAskedAt: { not: null }, salesRequest: { eventId, clientId } },
    select: { id: true, salesRequestId: true, slotId: true, checkIn: true, checkOut: true, slot: { select: { category: { select: { propertyId: true } } } } },
  });
  const touched = new Set<string>();
  for (const stay of stays) {
    const sold = await tx.roomNight.count({ where: { slotId: stay.slotId, eventId, clientId, salesState: "SOLD", date: { gte: stay.checkIn, lt: stay.checkOut } } });
    if (sold < eachNight(stay.checkIn, stay.checkOut).length) continue;
    await tx.roomingStay.update({ where: { id: stay.id }, data: { extraAskedAt: null } });
    touched.add(`${stay.salesRequestId}|${stay.slot.category.propertyId}`);
  }
  for (const key of touched) {
    const [salesRequestId, propertyId] = key.split("|") as [string, string];
    await syncExtensionTask(tx, salesRequestId, propertyId, actorId, true);
  }
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
  /** The sheet's own line for a room ("Apt #"): stays with the same one go in the same room where they can. */
  roomKey?: string | null;
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
  // The room each of the sheet's room lines went into, so its later stays follow it.
  const lines = new Map<string, string>();
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
    // The same person can stay twice (a room change, a second trip): their stay on the list is the one
    // these dates overlap — or, with no dates in the sheet, their only one.
    const theirs = active.filter((stay) => !usedStays.has(stay.id) && stay.guests.some((guest) => keys.has(personKey(guest))));
    const existing =
      row.checkIn && row.checkOut ? theirs.find((stay) => overlaps(stay, { checkIn: row.checkIn!, checkOut: row.checkOut! })) : theirs.length === 1 ? theirs[0] : undefined;

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
    // Within the booking first; else next to or overlapping it — an extension request.
    const touches = (room: (typeof rooms)[number]) => room.booked.some((run) => checkIn <= run.checkOut && checkOut >= run.checkIn);
    const within = candidates.filter((room) => covers(room.booked, checkIn, checkOut));
    const inBooking = within.length ? within : candidates.filter(touches);
    if (!inBooking.length) {
      const booked = [...new Set(candidates.flatMap((room) => room.booked.map((run) => fmt(run.checkIn, run.checkOut))))].join(", ");
      problems.push({ rows: row.rows, guests: who, message: `${fmt(checkIn, checkOut)} is outside the booking and does not touch it — these rooms are booked ${booked}.` });
      continue;
    }
    if (!within.length) {
      const booked = [...new Set(inBooking.flatMap((room) => room.booked.map((run) => fmt(run.checkIn, run.checkOut))))].join(", ");
      warning = `Asks for nights beyond the booking (${booked}) — an extension request for acquisitions.`;
    }
    const fits = inBooking.filter((room) => room.capacity >= guests.length);
    if (!fits.length) {
      problems.push({ rows: row.rows, guests: who, message: `${guests.length} guests, but these rooms sleep ${Math.max(...inBooking.map((room) => room.capacity))}.` });
      continue;
    }
    const stay = { checkIn, checkOut };
    const free = (room: (typeof rooms)[number]) => !taken.some((other) => other.slotId === room.slotId && other.stayId !== (existing?.id ?? "-") && overlaps(other, stay));
    const sameLine = row.roomKey ? lines.get(row.roomKey) : undefined;
    const room =
      (existing && fits.find((one) => one.slotId === existing.slotId && free(one))) ?? (sameLine && fits.find((one) => one.slotId === sameLine && free(one))) ?? fits.find(free);
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
    if (row.roomKey && !lines.has(row.roomKey)) lines.set(row.roomKey, room.slotId);
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

// --- The master list per property (doc §6.9, the owner 2026-11-23) ------------------

/**
 * A property's master rooming list at an event: every client with rooms sold
 * there, each with their rooms and stays as on their own list, and the
 * property's versions — what the hotel gets.
 */
export async function masterList(db: Db, eventId: string, propertyId: string) {
  const [clients, versions, property] = await Promise.all([
    db.roomNight.findMany({ where: { eventId, salesState: "SOLD", clientId: { not: null }, slot: { category: { propertyId } } }, select: { clientId: true }, distinct: ["clientId"] }),
    db.roomingVersion.findMany({ where: { eventId, propertyId }, orderBy: { number: "desc" }, include: { sentBy: { select: { name: true, email: true } } } }),
    db.property.findUniqueOrThrow({ where: { id: propertyId }, select: { id: true, name: true, checkInTime: true, checkOutTime: true } }),
  ]);
  const ids = clients.map((one) => one.clientId!).filter(Boolean);
  const [names, requests] = await Promise.all([
    db.client.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } }),
    // The client's list is edited through one of their requests at the event — the latest.
    db.salesRequest.findMany({ where: { eventId, clientId: { in: ids } }, orderBy: { createdAt: "desc" }, select: { id: true, clientId: true, roomingFields: true } }),
  ]);
  const out = [];
  for (const clientId of ids) {
    const [list] = await roomingFor(db, { clientId, eventId }, { forClient: false, propertyId });
    out.push({
      clientId,
      client: names.find((one) => one.id === clientId)?.name ?? "A client",
      salesRequestId: requests.find((one) => one.clientId === clientId)?.id ?? null,
      fields: requests.find((one) => one.clientId === clientId)?.roomingFields ?? [],
      rooms: list?.rooms ?? [],
    });
  }
  out.sort((a, b) => a.client.localeCompare(b.client));
  const last = versions[0];
  return {
    property: { id: property.id, name: property.name, times: [property.checkInTime && `check-in from ${property.checkInTime}`, property.checkOutTime && `check-out by ${property.checkOutTime}`].filter(Boolean).join(", ") || null },
    version: last?.number ?? null,
    sentAt: last?.sentAt ?? null,
    sentBy: last?.sentBy ? (last.sentBy.name ?? last.sentBy.email) : null,
    versions: versions.map((one) => ({ number: one.number, sentAt: one.sentAt, sentBy: one.sentBy ? (one.sentBy.name ?? one.sentBy.email) : null })),
    clients: out,
  };
}
