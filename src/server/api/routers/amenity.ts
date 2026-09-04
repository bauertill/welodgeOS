import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";

/**
 * The controlled amenity vocabulary. Read-only from the app: the list is
 * curated in the seed so that amenities stay a filter rather than a tag soup
 * (doc §3.4).
 */
export const amenityRouter = createTRPCRouter({
  list: protectedProcedure.query(({ ctx }) =>
    ctx.db.amenity.findMany({ orderBy: { sortOrder: "asc" } }),
  ),
});
