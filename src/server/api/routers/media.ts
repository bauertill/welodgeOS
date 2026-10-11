import { TRPCError } from "@trpc/server";
import { z } from "zod";

import { isDropboxFolder, isLink, photoSrc } from "~/lib/media";
import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";
import { logAudit } from "~/server/audit";

const MAX_PHOTOS = 60;
const link = z.string().trim().max(2000);

/**
 * A property's media (doc §3.10, Media): the YouTube video, the Dropbox folder
 * with all the team's photos, and the photos picked from it for clients —
 * Dropbox links, in order, the first the cover, each perhaps a room category's.
 */
export const mediaRouter = createTRPCRouter({
  forProperty: protectedProcedure.input(z.object({ propertyId: z.string() })).query(async ({ ctx, input }) => {
    const property = await ctx.db.property.findUnique({
      where: { id: input.propertyId },
      select: {
        videoUrl: true,
        photosUrl: true,
        categories: { select: { id: true, name: true }, orderBy: { sortOrder: "asc" } },
        photos: { orderBy: [{ position: "asc" }, { createdAt: "asc" }], include: { category: { select: { name: true } } } },
      },
    });
    if (!property) throw new TRPCError({ code: "NOT_FOUND", message: "This property no longer exists." });
    return {
      videoUrl: property.videoUrl,
      photosUrl: property.photosUrl,
      categories: property.categories,
      photos: property.photos.map((photo) => ({
        id: photo.id,
        url: photo.url,
        src: photoSrc(photo.url),
        name: photo.name,
        caption: photo.caption,
        categoryId: photo.categoryId,
        categoryName: photo.category?.name ?? null,
      })),
    };
  }),

  setLinks: protectedProcedure
    .input(z.object({ propertyId: z.string(), videoUrl: link, photosUrl: link }))
    .mutation(async ({ ctx, input }) => {
      for (const value of [input.videoUrl, input.photosUrl]) {
        if (value && !isLink(value)) throw new TRPCError({ code: "BAD_REQUEST", message: "That does not look like a link — it should start with https://" });
      }
      const before = await ctx.db.property.findUniqueOrThrow({ where: { id: input.propertyId }, select: { videoUrl: true, photosUrl: true } });
      await ctx.db.property.update({ where: { id: input.propertyId }, data: { videoUrl: input.videoUrl || null, photosUrl: input.photosUrl || null } });
      const changed = [
        (before.videoUrl ?? "") !== input.videoUrl ? "video" : null,
        (before.photosUrl ?? "") !== input.photosUrl ? "photos folder" : null,
      ].filter(Boolean);
      if (changed.length) await logAudit(ctx.db, { actorId: ctx.session.user.id, entity: "Property", entityId: input.propertyId, summary: `Media: ${changed.join(" and ")} link changed` });
      return { ok: true };
    }),

  addPhotos: protectedProcedure
    .input(z.object({ propertyId: z.string(), photos: z.array(z.object({ url: link, name: z.string().max(300).optional() })).min(1).max(MAX_PHOTOS) }))
    .mutation(async ({ ctx, input }) => {
      const photos = input.photos.filter((photo) => photo.url);
      for (const photo of photos) {
        if (!isLink(photo.url)) throw new TRPCError({ code: "BAD_REQUEST", message: "Each photo needs its own link, starting with https://" });
        if (isDropboxFolder(photo.url)) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "That is a link to a folder — use Copy link on the photo itself, or put the folder under Photos folder." });
        }
      }
      return ctx.db.$transaction(async (tx) => {
        const existing = await tx.propertyPhoto.findMany({ where: { propertyId: input.propertyId }, select: { url: true, position: true } });
        const have = new Set(existing.map((photo) => photo.url));
        const fresh = photos.filter((photo, index) => !have.has(photo.url) && photos.findIndex((other) => other.url === photo.url) === index);
        if (existing.length + fresh.length > MAX_PHOTOS) {
          throw new TRPCError({ code: "BAD_REQUEST", message: `Up to ${MAX_PHOTOS} photos per property — pick the best ones; the rest stay in the Dropbox folder.` });
        }
        const start = existing.reduce((max, photo) => Math.max(max, photo.position + 1), 0);
        await tx.propertyPhoto.createMany({
          data: fresh.map((photo, index) => ({
            propertyId: input.propertyId,
            url: photo.url,
            name: photo.name?.trim() || null,
            position: start + index,
            addedById: ctx.session.user.id,
          })),
        });
        if (fresh.length) {
          await logAudit(tx, { actorId: ctx.session.user.id, entity: "Property", entityId: input.propertyId, summary: `Media: ${fresh.length} ${fresh.length === 1 ? "photo" : "photos"} added for clients` });
        }
        return { added: fresh.length, skipped: photos.length - fresh.length };
      });
    }),

  updatePhoto: protectedProcedure
    .input(z.object({ id: z.string(), caption: z.string().trim().max(300), categoryId: z.string().nullable() }))
    .mutation(async ({ ctx, input }) => {
      const photo = await ctx.db.propertyPhoto.findUniqueOrThrow({ where: { id: input.id }, select: { propertyId: true } });
      if (input.categoryId) {
        const own = await ctx.db.roomCategory.count({ where: { id: input.categoryId, propertyId: photo.propertyId } });
        if (!own) throw new TRPCError({ code: "BAD_REQUEST", message: "That room category is not this property's." });
      }
      await ctx.db.propertyPhoto.update({ where: { id: input.id }, data: { caption: input.caption || null, categoryId: input.categoryId } });
      return { ok: true };
    }),

  /** Move a photo to the front (the cover), or one place earlier or later. */
  movePhoto: protectedProcedure
    .input(z.object({ id: z.string(), to: z.enum(["cover", "earlier", "later"]) }))
    .mutation(async ({ ctx, input }) => {
      await ctx.db.$transaction(async (tx) => {
        const photo = await tx.propertyPhoto.findUniqueOrThrow({ where: { id: input.id }, select: { propertyId: true } });
        const order = (await tx.propertyPhoto.findMany({ where: { propertyId: photo.propertyId }, orderBy: [{ position: "asc" }, { createdAt: "asc" }], select: { id: true } })).map(
          (one) => one.id,
        );
        const at = order.indexOf(input.id);
        order.splice(at, 1);
        const target = input.to === "cover" ? 0 : input.to === "earlier" ? Math.max(0, at - 1) : Math.min(order.length, at + 1);
        order.splice(target, 0, input.id);
        for (const [position, id] of order.entries()) await tx.propertyPhoto.update({ where: { id }, data: { position } });
      });
      return { ok: true };
    }),

  removePhoto: protectedProcedure.input(z.object({ id: z.string() })).mutation(async ({ ctx, input }) => {
    const photo = await ctx.db.propertyPhoto.delete({ where: { id: input.id }, select: { propertyId: true, name: true } });
    await logAudit(ctx.db, {
      actorId: ctx.session.user.id,
      entity: "Property",
      entityId: photo.propertyId,
      summary: `Media: photo removed${photo.name ? ` (${photo.name})` : ""} — also off any rate card showing it`,
    });
    return { ok: true };
  }),
});
