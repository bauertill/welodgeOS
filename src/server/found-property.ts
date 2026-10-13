import type { Prisma } from "generated/prisma";
import { TRPCError } from "@trpc/server";
import { z } from "zod";

import { logAudit } from "~/server/audit";
import { ensureHotelContactTask } from "~/server/hotel-contact";

/**
 * A place to stay found on the map, added to our properties (doc §3.9,
 * §4.11): created from what the map knows, put on the event's list, and a
 * hotel contact task made for it — from a sales request's sourcing task, or
 * in general from the event's map.
 */
export const foundPlaceInput = z.object({
  name: z.string().trim().min(1).max(300),
  type: z.enum(["HOTEL", "APARTMENT", "APARTHOTEL"]),
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  address: z.string().max(500).nullable(),
  city: z.string().max(200).nullable(),
  country: z.string().max(200).nullable(),
  website: z.string().max(2000).nullable(),
  phone: z.string().max(200).nullable(),
  stars: z.number().int().min(1).max(5).nullable(),
  rooms: z.number().int().min(1).nullable(),
  source: z.enum(["google", "osm", "map"]),
});

export async function createFoundProperty(
  tx: Prisma.TransactionClient,
  input: {
    place: z.infer<typeof foundPlaceInput>;
    eventId: string | null;
    salesRequestId: string | null;
    /** Said in its notes: "while sourcing for Beyond Limits", or "near the IBC for LA28". */
    foundWhile: string;
    actorId: string;
  },
) {
  const { place } = input;
  const already = await tx.property.findFirst({ where: { name: { equals: place.name, mode: "insensitive" } }, select: { id: true } });
  if (already) throw new TRPCError({ code: "BAD_REQUEST", message: `${place.name} is already in our properties.` });
  const where = place.source === "google" ? "Google Maps" : "OpenStreetMap";
  // Spotted on the ground and pointed at on the map, rather than found by search (doc §3.9).
  const how = place.source === "map" ? `Spotted on the ground and added from the map ${input.foundWhile}` : `Found on ${where} ${input.foundWhile}`;
  const property = await tx.property.create({
    data: {
      name: place.name,
      type: place.type,
      latitude: place.latitude,
      longitude: place.longitude,
      address: place.address,
      city: place.city,
      country: place.country,
      website: place.website,
      phone: place.phone,
      stars: place.type === "HOTEL" ? place.stars : null,
      totalRooms: place.rooms,
      scoutedById: input.actorId,
      notes: `${how}.`,
    },
  });
  await logAudit(tx, { actorId: input.actorId, entity: "Property", entityId: property.id, summary: `Added — ${how.charAt(0).toLowerCase()}${how.slice(1)}` });
  let taskId: string | null = null;
  if (input.eventId) {
    const entry = await tx.scoutingEntry.create({ data: { eventId: input.eventId, propertyId: property.id, addedById: input.actorId } });
    await logAudit(tx, { actorId: input.actorId, entity: "ScoutingEntry", entityId: entry.id, summary: "Added to the scouting list" });
    // Someone now reaches out to it, to gather what we need (doc §4.11).
    const task = await ensureHotelContactTask(tx, { propertyId: property.id, eventId: input.eventId, salesRequestId: input.salesRequestId, actorId: input.actorId });
    taskId = task?.id ?? null;
  }
  return { id: property.id, taskId };
}
