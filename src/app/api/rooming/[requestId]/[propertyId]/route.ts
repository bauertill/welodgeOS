import { NextResponse } from "next/server";

import { dayKey, eachNight, nightsBetween, parseDay } from "~/lib/dates";
import { formatDate } from "~/lib/format";
import { guestName, roomingExtraFields, stayChanges, type StaySnapshot } from "~/lib/rooming";
import { STYLE, workbook, type Sheet } from "~/lib/xlsx";
import { auth } from "~/server/auth";
import { db } from "~/server/db";
import { roomingList, snapshotOf, snapshotsOf } from "~/server/rooming";

/**
 * A property's rooming list as an Excel file, made to be read by the hotel at
 * a glance (doc §6.9): a few lines saying whose list it is, which version and
 * the property's check-in times, then one row per guest — room, dates, name,
 * who they share with — with every row changed since the last version in
 * yellow, and a second sheet listing those changes, cancellations included.
 * ?version=3 gives V3 as it was sent.
 */
export async function GET(request: Request, { params }: { params: Promise<{ requestId: string; propertyId: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  const { requestId, propertyId } = await params;
  const wanted = Number(new URL(request.url).searchParams.get("version") ?? "") || null;

  const { request: sale, properties } = await roomingList(db, requestId, { forClient: false });
  const property = properties.find((one) => one.id === propertyId);
  if (!property) return NextResponse.json({ error: "No rooms at that property for this client." }, { status: 404 });
  const versions = await db.roomingVersion.findMany({ where: { salesRequestId: requestId, propertyId }, orderBy: { number: "asc" }, include: { sentBy: { select: { name: true, email: true } } } });

  // What the file shows, and what it is compared with.
  let current: StaySnapshot[];
  let previous: StaySnapshot[] | null;
  let label: string;
  let compared: number | null;
  if (wanted) {
    const version = versions.find((one) => one.number === wanted);
    if (!version) return NextResponse.json({ error: `There is no V${wanted}.` }, { status: 404 });
    current = snapshotsOf(version.stays);
    const before = versions.find((one) => one.number === wanted - 1);
    previous = before ? snapshotsOf(before.stays) : null;
    compared = before ? before.number : null;
    label = `V${version.number} — sent ${formatDate(version.sentAt)}${version.sentBy ? ` by ${version.sentBy.name ?? version.sentBy.email}` : ""}`;
  } else {
    const stays = await db.roomingStay.findMany({ where: { salesRequestId: requestId, removedAt: null, slot: { category: { propertyId } } }, orderBy: { checkIn: "asc" } });
    current = stays.map(snapshotOf);
    const last = versions.at(-1);
    previous = last ? snapshotsOf(last.stays) : null;
    compared = last?.number ?? null;
    label = last ? `V${last.number + 1} — the latest, not yet marked as sent` : "V1 — the first list";
  }

  // Every room the file may name — the client's now, and any a version had.
  const slotIds = [...new Set([...current, ...(previous ?? [])].map((stay) => stay.slotId))];
  const slots = await db.roomSlot.findMany({ where: { id: { in: slotIds } }, select: { id: true, slotNumber: true, unitNumber: true, category: { select: { name: true } } } });
  const rooms = new Map(property.rooms.map((room) => [room.slotId, room]));
  const roomOf = (slotId: string) => {
    const known = rooms.get(slotId);
    const slot = slots.find((one) => one.id === slotId);
    return { category: known?.category ?? slot?.category.name ?? "", unitNumber: known?.unitNumber ?? slot?.unitNumber ?? null, slotNumber: known?.slotNumber ?? slot?.slotNumber ?? 0 };
  };
  const roomLabel = (slotId: string) => {
    const room = roomOf(slotId);
    return `${room.category} ${room.unitNumber ? `No. ${room.unitNumber}` : `(our room ${room.slotNumber})`}`;
  };
  const day = (key: string) => formatDate(parseDay(key));

  const extras = roomingExtraFields.filter((field) => sale.roomingFields.includes(field.key));
  const header = ["Room no.", "Room type", "Arrival", "Departure", "Nights", "Last name", "First name", "Sharing with", ...extras.map((field) => field.label), "Arriving (time / flight)", "Notes", ...(previous ? [`Change since V${compared}`] : []), "We Lodge ref."];

  type Line = { sort: string; cells: (string | number | null)[]; changed: boolean };
  const lines: Line[] = [];
  const before = new Map((previous ?? []).map((stay) => [stay.stayId, stay]));
  let guests = 0;
  for (const stay of current) {
    const room = roomOf(stay.slotId);
    const was = before.get(stay.stayId);
    const changes = previous ? (was ? stayChanges(was, stay, roomLabel) : ["new"]) : [];
    const change = !previous ? null : !was ? "New" : changes.length ? `Changed: ${changes.join("; ")}` : "";
    stay.guests.forEach((guest, i) => {
      guests++;
      lines.push({
        sort: `${room.unitNumber ?? "~"}|${room.category}|${String(room.slotNumber).padStart(5, "0")}|${stay.checkIn}|${i}`,
        changed: Boolean(change),
        cells: [
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
  // The live list also shows booked nights nobody is named for yet, so the hotel sees the whole booking.
  if (!wanted) {
    for (const room of property.rooms) {
      const named = new Set(current.filter((stay) => stay.slotId === room.slotId).flatMap((stay) => eachNight(parseDay(stay.checkIn), parseDay(stay.checkOut)).map(dayKey)));
      for (const booked of room.booked) {
        const free = eachNight(parseDay(booked.checkIn), parseDay(booked.checkOut)).filter((night) => !named.has(dayKey(night)));
        // Consecutive free nights as one line.
        let start: Date | null = null;
        let last: Date | null = null;
        const flush = () => {
          if (!start || !last) return;
          const out = new Date(last.getTime() + 864e5);
          lines.push({
            sort: `${room.unitNumber ?? "~"}|${room.category}|${String(room.slotNumber).padStart(5, "0")}|${dayKey(start)}|9`,
            changed: false,
            cells: [room.unitNumber, room.category, formatDate(start), formatDate(out), nightsBetween(start, out), "To be named", null, null, ...extras.map(() => null), null, null, ...(previous ? [""] : []), `${room.category} ${room.slotNumber}`],
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
  lines.sort((a, b) => a.sort.localeCompare(b.sort));

  const top: (string | number | null)[][] = [
    [`Rooming list — ${property.name}`],
    [`Client: ${sale.client.name}${sale.event ? ` · ${sale.event.name}` : ""}`],
    [`Version: ${label}`],
    ...(property.times ? [[`At the property: ${property.times}`]] : []),
    [`${property.rooms.length} room${property.rooms.length === 1 ? "" : "s"} · ${guests} guest${guests === 1 ? "" : "s"} named${previous ? ` · rows in yellow changed since V${compared} — see the "Changes since V${compared}" sheet` : ""}`],
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
      widths: [10, 22, 13, 13, 7, 18, 18, 24, ...extras.map(() => 16), 20, 28, ...(previous ? [36] : []), 16],
    },
  ];

  if (previous) {
    const now = new Map(current.map((stay) => [stay.stayId, stay]));
    const changeRows: (string | number | null)[][] = [];
    const removed: number[] = [];
    for (const stay of current) {
      const was = before.get(stay.stayId);
      if (!was) changeRows.push(["New", roomLabel(stay.slotId), stay.guests.map(guestName).join(", "), null, `${day(stay.checkIn)} – ${day(stay.checkOut)}`]);
      else {
        const changes = stayChanges(was, stay, roomLabel);
        if (changes.length) changeRows.push(["Changed", roomLabel(stay.slotId), stay.guests.map(guestName).join(", "), `${roomLabel(was.slotId)}, ${day(was.checkIn)} – ${day(was.checkOut)}`, changes.join("; ")]);
      }
    }
    for (const was of previous) {
      if (now.has(was.stayId)) continue;
      removed.push(changeRows.length + 3);
      changeRows.push(["Cancelled", roomLabel(was.slotId), was.guests.map(guestName).join(", "), `${day(was.checkIn)} – ${day(was.checkOut)}`, "No longer staying"]);
    }
    const styles: Record<number, number> = { 0: STYLE.title };
    for (const row of removed) styles[row] = STYLE.removed;
    sheets.push({
      name: `Changes since V${compared}`,
      rows: [[`Changes since V${compared}`], [], ["Change", "Room", "Guests", "Was", "Now"], ...(changeRows.length ? changeRows : [["No changes", null, null, null, null]])],
      headerRow: 2,
      rowStyles: styles,
      widths: [12, 28, 34, 34, 60],
    });
  }

  const file = await workbook(sheets);
  const versionText = wanted ? ` V${wanted}` : "";
  const name = `Rooming list${versionText} - ${sale.client.name} - ${property.name}.xlsx`.replace(/[\\/:*?"<>|]/g, "-");
  return new Response(new Blob([file as BlobPart]), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(name)}`,
      "Cache-Control": "private, no-store",
    },
  });
}
