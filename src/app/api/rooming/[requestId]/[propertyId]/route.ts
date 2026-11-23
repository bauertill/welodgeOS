import { NextResponse } from "next/server";

import { nightsBetween, parseDay } from "~/lib/dates";
import { formatDate } from "~/lib/format";
import { workbook } from "~/lib/xlsx";
import { auth } from "~/server/auth";
import { db } from "~/server/db";
import { guestName, roomingList } from "~/server/rooming";

/**
 * A property's rooming list as an Excel file, for the team to send it (doc
 * §6.9): one row per stay — and one per booked stretch nobody is named for
 * yet — with the room, its number, the dates and the guests.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ requestId: string; propertyId: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  const { requestId, propertyId } = await params;
  const { request, properties } = await roomingList(db, requestId, { forClient: false });
  const property = properties.find((one) => one.id === propertyId);
  if (!property) return NextResponse.json({ error: "No rooms at that property for this client." }, { status: 404 });

  const most = Math.max(1, ...property.rooms.flatMap((room) => room.stays.filter((stay) => !stay.removed).map((stay) => stay.guests.length)));
  const header = ["Room type", "Room number", "Our room", "Check-in", "Check-out", "Nights", ...Array.from({ length: most }, (_, i) => (most === 1 ? "Guest" : `Guest ${i + 1}`)), "Arrival", "Notes"];
  const rows: (string | number | null)[][] = [header];
  for (const room of property.rooms) {
    const stays = room.stays.filter((stay) => !stay.removed);
    for (const stay of stays) {
      const names = stay.guests.map(guestName);
      rows.push([room.category, room.unitNumber, room.slotNumber, formatDate(parseDay(stay.checkIn)), formatDate(parseDay(stay.checkOut)), nightsBetween(parseDay(stay.checkIn), parseDay(stay.checkOut)), ...Array.from({ length: most }, (_, i) => names[i] ?? null), stay.arrival, stay.notes]);
    }
    if (!stays.length) {
      for (const booked of room.booked) {
        rows.push([room.category, room.unitNumber, room.slotNumber, formatDate(parseDay(booked.checkIn)), formatDate(parseDay(booked.checkOut)), nightsBetween(parseDay(booked.checkIn), parseDay(booked.checkOut)), "To be named", ...Array.from({ length: most - 1 }, () => null), null, null]);
      }
    }
  }
  const file = await workbook([{ name: property.name, rows, widths: [24, 12, 9, 12, 12, 8, ...Array.from({ length: most }, () => 24), 22, 30] }]);
  const name = `Rooming list - ${request.client.name} - ${property.name}.xlsx`.replace(/[\\/:*?"<>|]/g, "-");
  return new Response(new Blob([file as BlobPart]), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(name)}`,
      "Cache-Control": "private, no-store",
    },
  });
}
