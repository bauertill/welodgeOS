import { TRPCError } from "@trpc/server";
import { z } from "zod";

import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";
import { logAudit } from "~/server/audit";
import { geocode } from "~/server/places";

/** "5* Fairmont Breakers" and "Fairmont Breakers" are one hotel: names compared without the stars in front. */
export const bareName = (name: string) => name.replace(/^\s*\d(?:[.,]\d)?\s*\*\s*/, "").trim().toLowerCase();

const color = z.string().regex(/^#[0-9a-fA-F]{6}$/, "Choose a colour");

/**
 * An event's map layers (doc §3.7, 2026-10-13), as in Google My Maps: named,
 * coloured sets of places, shown or hidden together on the map; distances are
 * measured to the places of the layers that say so. Imported from a My Maps
 * export (KML) — each of its layers becomes one of ours.
 */
export const mapLayerRouter = createTRPCRouter({
  listForEvent: protectedProcedure.input(z.object({ eventId: z.string() })).query(({ ctx, input }) =>
    ctx.db.mapLayer.findMany({
      where: { eventId: input.eventId },
      orderBy: [{ position: "asc" }, { name: "asc" }],
      include: { _count: { select: { places: true } } },
    }),
  ),

  save: protectedProcedure
    .input(z.object({ eventId: z.string(), id: z.string().optional(), name: z.string().trim().min(1, "Give the layer a name").max(100), color, measured: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      const clash = await ctx.db.mapLayer.findFirst({
        where: { eventId: input.eventId, name: { equals: input.name, mode: "insensitive" }, ...(input.id ? { id: { not: input.id } } : {}) },
        select: { id: true },
      });
      if (clash) throw new TRPCError({ code: "BAD_REQUEST", message: `There is already a layer called "${input.name}".` });
      const data = { name: input.name, color: input.color, measured: input.measured };
      const layer = input.id
        ? await ctx.db.mapLayer.update({ where: { id: input.id }, data })
        : await ctx.db.mapLayer.create({
            data: { ...data, eventId: input.eventId, position: (await ctx.db.mapLayer.count({ where: { eventId: input.eventId } })) },
          });
      await logAudit(ctx.db, { actorId: ctx.session.user.id, entity: "Event", entityId: input.eventId, summary: `Map layer ${input.id ? "changed" : "added"}: ${layer.name}` });
      return layer;
    }),

  /** A layer goes with its places; nothing is booked against a place, so nothing else goes. */
  remove: protectedProcedure.input(z.object({ id: z.string() })).mutation(async ({ ctx, input }) => {
    const layer = await ctx.db.mapLayer.delete({ where: { id: input.id }, include: { _count: { select: { places: true } } } });
    await logAudit(ctx.db, { actorId: ctx.session.user.id, entity: "Event", entityId: layer.eventId, summary: `Map layer removed: ${layer.name}` });
    return { ok: true };
  }),

  /**
   * A Google My Maps export, read in the browser: each of its layers, with its
   * points. A layer of the same name gets the new points; a place whose name
   * the event already has is left out, as two pins of one name are a mistake.
   */
  /**
   * A Google My Maps link pasted in (the owner, 2026-11-24): its KML fetched
   * from Google — the map must be shared so anyone with the link can view it —
   * to be read in the browser as an uploaded export is.
   */
  fetchMyMaps: protectedProcedure.input(z.object({ url: z.string().trim().min(1, "Paste the My Maps link.").max(2000) })).mutation(async ({ input }) => {
    const mid = /[?&]mid=([A-Za-z0-9_-]{10,100})/.exec(input.url)?.[1];
    if (!mid || !/google\.[a-z.]+\/maps\/d\//.test(input.url)) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "That is not a Google My Maps link — it looks like google.com/maps/d/…?mid=…" });
    }
    const response = await fetch(`https://www.google.com/maps/d/kml?mid=${mid}&forcekml=1`, { signal: AbortSignal.timeout(30_000) }).catch(() => null);
    const text = response?.ok ? await response.text() : null;
    if (!text || !text.includes("<kml")) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "Google did not give that map. In My Maps, Share it so anyone with the link can view, then try again — or export it as KML and upload the file." });
    }
    if (text.length > 15_000_000) throw new TRPCError({ code: "BAD_REQUEST", message: "That map is too big to read in one go." });
    return { kml: text };
  }),

  importLayers: protectedProcedure
    .input(
      z.object({
        eventId: z.string(),
        layers: z
          .array(
            z.object({
              name: z.string().trim().min(1).max(100),
              color,
              places: z
                .array(
                  z.object({
                    name: z.string().trim().min(1).max(200),
                    latitude: z.number().min(-90).max(90).nullable(),
                    longitude: z.number().min(-180).max(180).nullable(),
                    address: z.string().max(500).default(""),
                    notes: z.string().max(5000),
                  }),
                )
                .max(2000),
            }),
          )
          .min(1, "That file has no places in it.")
          .max(50),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      // A place with an address but no position (a layer built from a spreadsheet) is found by its address — one a second, as OpenStreetMap asks.
      const unplaced = input.layers.flatMap((layer) => layer.places).filter((place) => (place.latitude === null || place.longitude === null) && place.address.trim());
      if (unplaced.length > 120) throw new TRPCError({ code: "BAD_REQUEST", message: `${unplaced.length} places have only an address — import at most 120 of those at a time.` });
      let found = 0;
      for (const [i, place] of unplaced.entries()) {
        if (i) await new Promise((resolve) => setTimeout(resolve, 1100));
        const spot = await geocode([place.address]);
        if (spot) {
          place.latitude = spot.latitude;
          place.longitude = spot.longitude;
          found++;
        }
      }
      // Already a property on the event's board: shown as its own pin, so not again as a place.
      const onBoard = new Set((await ctx.db.scoutingEntry.findMany({ where: { eventId: input.eventId }, select: { property: { select: { name: true } } } })).map((entry) => bareName(entry.property.name)));
      return ctx.db.$transaction(
        async (tx) => {
          const taken = new Set((await tx.placeOfInterest.findMany({ where: { eventId: input.eventId }, select: { name: true } })).map((place) => place.name.toLowerCase()));
          let unlocated = 0;
          let properties = 0;
          let position = await tx.mapLayer.count({ where: { eventId: input.eventId } });
          let added = 0;
          let skipped = 0;
          for (const incoming of input.layers) {
            const existing = await tx.mapLayer.findFirst({ where: { eventId: input.eventId, name: { equals: incoming.name, mode: "insensitive" } }, select: { id: true } });
            const layerId =
              existing?.id ?? (await tx.mapLayer.create({ data: { eventId: input.eventId, name: incoming.name, color: incoming.color, position: position++ }, select: { id: true } })).id;
            const fresh = incoming.places.filter((place) => {
              const key = place.name.toLowerCase();
              if (place.latitude === null || place.longitude === null) {
                unlocated++;
                return false;
              }
              if (onBoard.has(bareName(place.name))) {
                properties++;
                return false;
              }
              if (taken.has(key)) {
                skipped++;
                return false;
              }
              taken.add(key);
              return true;
            });
            await tx.placeOfInterest.createMany({
              data: fresh.map((place) => ({
                eventId: input.eventId,
                layerId,
                name: place.name,
                category: "OTHER" as const,
                latitude: place.latitude!,
                longitude: place.longitude!,
                address: place.address.trim() || null,
                notes: place.notes.trim() || null,
              })),
            });
            added += fresh.length;
          }
          await logAudit(tx, {
            actorId: ctx.session.user.id,
            entity: "Event",
            entityId: input.eventId,
            summary: `Map imported from Google My Maps: ${input.layers.length} ${input.layers.length === 1 ? "layer" : "layers"}, ${added} places`,
          });
          return { layers: input.layers.length, added, skipped, properties, unlocated, found };
        },
        { timeout: 60_000 },
      );
    }),
});
