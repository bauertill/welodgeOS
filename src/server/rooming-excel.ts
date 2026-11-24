import { TRPCError } from "@trpc/server";

import type { Prisma, PrismaClient } from "generated/prisma";

import { dayKey, eachNight, nightsBetween, parseDay } from "~/lib/dates";
import { formatDate } from "~/lib/format";
import { guestName, roomingExtraFields, stayChanges, type StaySnapshot } from "~/lib/rooming";
import { STYLE, workbook, type Sheet } from "~/lib/xlsx";
import { masterList, snapshotOf, snapshotsOf } from "~/server/rooming";

type Snapshot = StaySnapshot & { clientId?: string; client?: string };
type Db = PrismaClient | Prisma.TransactionClient;

/**
 * A property's master rooming list as an Excel file, for the hotel (doc §6.9):
 * every room we have booked there at the event — every client's — read at a
 * glance: a few lines saying whose list it is, which version and the check-in
 * times, then one row per guest with the client, room, dates, name and who
 * they share with; every row changed since the last version in yellow, and a
 * second sheet listing those changes, cancellations included. `version` gives
 * that version as it was sent; `sending` labels the list now as the version
 * about to be emailed.
 */
export async function masterWorkbook(db: Db, eventId: string, propertyId: string, { version: wanted = null, sending = null }: { version?: number | null; sending?: { number: number; by: string } | null } = {}) {
  const master = await masterList(db, eventId, propertyId);
  const event = await db.event.findUnique({ where: { id: eventId }, select: { name: true } });
  const versions = await db.roomingVersion.findMany({ where: { eventId, propertyId }, orderBy: { number: "asc" }, include: { sentBy: { select: { name: true, email: true } } } });

  let current: Snapshot[];
  let previous: Snapshot[] | null;
  let label: string;
  let compared: number | null;
  if (wanted) {
    const version = versions.find((one) => one.number === wanted);
    if (!version) throw new TRPCError({ code: "NOT_FOUND", message: `There is no V${wanted}.` });
    current = snapshotsOf(version.stays) as Snapshot[];
    const before = versions.find((one) => one.number === wanted - 1);
    previous = before ? (snapshotsOf(before.stays) as Snapshot[]) : null;
    compared = before?.number ?? null;
    label = `V${version.number} — sent ${formatDate(version.sentAt)}${version.sentBy ? ` by ${version.sentBy.name ?? version.sentBy.email}` : ""}`;
  } else {
    const stays = await db.roomingStay.findMany({
      where: { removedAt: null, salesRequest: { eventId }, slot: { category: { propertyId } } },
      include: { salesRequest: { select: { clientId: true, client: { select: { name: true } } } } },
      orderBy: { checkIn: "asc" },
    });
    current = stays.map((stay) => ({ ...snapshotOf(stay), clientId: stay.salesRequest.clientId, client: stay.salesRequest.client.name }));
    const last = versions.at(-1);
    previous = last ? (snapshotsOf(last.stays) as Snapshot[]) : null;
    compared = last?.number ?? null;
    label = sending ? `V${sending.number} — sent ${formatDate(new Date())} by ${sending.by}` : last ? `V${last.number + 1} — the latest, not yet marked as sent` : "V1 — the first list";
  }

  // Every room the file may name — the clients' now, and any a version had.
  const known = new Map(master.clients.flatMap((client) => client.rooms.map((room) => [room.slotId, { ...room, client: client.client }] as const)));
  const slotIds = [...new Set([...current, ...(previous ?? [])].map((stay) => stay.slotId))].filter((id) => !known.has(id));
  const slots = await db.roomSlot.findMany({ where: { id: { in: slotIds } }, select: { id: true, slotNumber: true, unitNumber: true, category: { select: { name: true } } } });
  const roomOf = (slotId: string) => {
    const room = known.get(slotId);
    const slot = slots.find((one) => one.id === slotId);
    return { category: room?.category ?? slot?.category.name ?? "", unitNumber: room?.unitNumber ?? slot?.unitNumber ?? null, slotNumber: room?.slotNumber ?? slot?.slotNumber ?? 0 };
  };
  const roomLabel = (slotId: string) => {
    const room = roomOf(slotId);
    return `${room.category} ${room.unitNumber ? `No. ${room.unitNumber}` : `(our room ${room.slotNumber})`}`;
  };
  const day = (key: string) => formatDate(parseDay(key));

  // Extra details any client's list asks for get a column.
  const asked = await db.salesRequest.findMany({ where: { eventId, clientId: { in: master.clients.map((one) => one.clientId) } }, select: { roomingFields: true } });
  const extras = roomingExtraFields.filter((field) => asked.some((one) => one.roomingFields.includes(field.key)));
  const header = ["Client", "Room no.", "Room type", "Arrival", "Departure", "Nights", "Last name", "First name", "Sharing with", ...extras.map((field) => field.label), "Arriving (time / flight)", "Notes", ...(previous ? [`Change since V${compared}`] : []), "We Lodge ref."];

  type Line = { sort: string; cells: (string | number | null)[]; changed: boolean };
  const lines: Line[] = [];
  const before = new Map((previous ?? []).map((stay) => [stay.stayId, stay]));
  let guests = 0;
  const key = (client: string, room: ReturnType<typeof roomOf>, date: string, i: number) => `${client}|${room.unitNumber ?? "~"}|${room.category}|${String(room.slotNumber).padStart(5, "0")}|${date}|${i}`;
  for (const stay of current) {
    const room = roomOf(stay.slotId);
    const was = before.get(stay.stayId);
    const changes = previous && was ? stayChanges(was, stay, roomLabel) : [];
    const change = !previous ? null : !was ? "New" : changes.length ? `Changed: ${changes.join("; ")}` : "";
    const client = stay.client ?? "";
    stay.guests.forEach((guest, i) => {
      guests++;
      lines.push({
        sort: key(client, room, stay.checkIn, i),
        changed: Boolean(change),
        cells: [
          client,
          room.unitNumber,
          room.category,
          day(stay.checkIn),
          day(stay.checkOut),
          nightsBetween(parseDay(stay.checkIn), parseDay(stay.checkOut)),
          guest.lastName,
          guest.firstName,
          stay.guests.filter((_, j) => j !== i).map(guestName).join(", ") || null,
          ...extras.map((field) => guest[field.key] ?? null),
          stay.arrival,
          stay.notes,
          ...(previous ? [change] : []),
          `${room.category} ${room.slotNumber}`,
        ],
      });
    });
  }
  // The live list also shows booked nights nobody is named for yet, so the hotel sees every room booked.
  let roomCount = 0;
  if (!wanted) {
    for (const client of master.clients) {
      for (const room of client.rooms) {
        roomCount++;
        const named = new Set(current.filter((stay) => stay.slotId === room.slotId).flatMap((stay) => eachNight(parseDay(stay.checkIn), parseDay(stay.checkOut)).map(dayKey)));
        for (const booked of room.booked) {
          const free = eachNight(parseDay(booked.checkIn), parseDay(booked.checkOut)).filter((night) => !named.has(dayKey(night)));
          let start: Date | null = null;
          let last: Date | null = null;
          const flush = () => {
            if (!start || !last) return;
            const out = new Date(last.getTime() + 864e5);
            lines.push({
              sort: key(client.client, room, dayKey(start), 9),
              changed: false,
              cells: [client.client, room.unitNumber, room.category, formatDate(start), formatDate(out), nightsBetween(start, out), "To be named", null, null, ...extras.map(() => null), null, null, ...(previous ? [""] : []), `${room.category} ${room.slotNumber}`],
            });
          };
          for (const night of free) {
            if (last && night.getTime() - last.getTime() === 864e5) last = night;
            else {
              flush();
              start = night;
              last = night;
            }
          }
          flush();
        }
      }
    }
  } else roomCount = new Set(current.map((stay) => stay.slotId)).size;
  lines.sort((a, b) => a.sort.localeCompare(b.sort));

  const changedCount = lines.filter((line) => line.changed).length;
  const cancelledCount = previous ? previous.filter((was) => !current.some((stay) => stay.stayId === was.stayId)).length : 0;
  const clientCount = wanted ? new Set(current.map((stay) => stay.clientId)).size : master.clients.length;
  const top: (string | number | null)[][] = [
    [`Rooming list — ${master.property.name}`],
    [`From We Lodge${event ? ` · ${event.name}` : ""} · ${clientCount} client${clientCount === 1 ? "" : "s"}`],
    [`Version: ${label}`],
    ...(master.property.times ? [[`At the property: ${master.property.times}`]] : []),
    [`${roomCount} room${roomCount === 1 ? "" : "s"} · ${guests} guest${guests === 1 ? "" : "s"} named${previous ? (changedCount || cancelledCount ? ` · rows in yellow changed since V${compared} — see the "Changes since V${compared}" sheet` : ` · no changes since V${compared}`) : ""}`],
    [],
  ];
  const headerRow = top.length;
  const rowStyles: Record<number, number> = { 0: STYLE.title };
  for (let i = 1; i < headerRow - 1; i++) rowStyles[i] = STYLE.muted;
  lines.forEach((line, i) => {
    if (line.changed) rowStyles[headerRow + 1 + i] = STYLE.highlight;
  });
  const sheets: Sheet[] = [
    {
      name: "Rooming list",
      rows: [...top, header, ...lines.map((line) => line.cells)],
      headerRow,
      rowStyles,
      widths: [20, 10, 22, 13, 13, 7, 18, 18, 24, ...extras.map(() => 16), 20, 28, ...(previous ? [36] : []), 16],
    },
  ];

  if (previous) {
    const now = new Map(current.map((stay) => [stay.stayId, stay]));
    const rows: (string | number | null)[][] = [];
    const removed: number[] = [];
    for (const stay of current) {
      const was = before.get(stay.stayId);
      if (!was) rows.push(["New", stay.client ?? "", roomLabel(stay.slotId), stay.guests.map(guestName).join(", "), null, `${day(stay.checkIn)} – ${day(stay.checkOut)}`]);
      else {
        const changes = stayChanges(was, stay, roomLabel);
        if (changes.length) rows.push(["Changed", stay.client ?? "", roomLabel(stay.slotId), stay.guests.map(guestName).join(", "), `${roomLabel(was.slotId)}, ${day(was.checkIn)} – ${day(was.checkOut)}`, changes.join("; ")]);
      }
    }
    for (const was of previous) {
      if (now.has(was.stayId)) continue;
      removed.push(rows.length + 3);
      rows.push(["Cancelled", was.client ?? "", roomLabel(was.slotId), was.guests.map(guestName).join(", "), `${day(was.checkIn)} – ${day(was.checkOut)}`, "No longer staying"]);
    }
    const styles: Record<number, number> = { 0: STYLE.title };
    for (const row of removed) styles[row] = STYLE.removed;
    sheets.push({
      name: `Changes since V${compared}`,
      rows: [[`Changes since V${compared}`], [], ["Change", "Client", "Room", "Guests", "Was", "Now"], ...(rows.length ? rows : [["No changes", null, null, null, null, null]])],
      headerRow: 2,
      rowStyles: styles,
      widths: [12, 20, 28, 34, 34, 60],
    });
  }

  const file = await workbook(sheets);
  const name = `Rooming list${wanted ? ` V${wanted}` : sending ? ` V${sending.number}` : ""} - ${master.property.name}${event ? ` - ${event.name}` : ""}.xlsx`.replace(/[\\/:*?"<>|]/g, "-");
  return { file, name };
}
