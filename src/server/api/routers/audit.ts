import { z } from "zod";

import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";

/**
 * The general audit trail (doc §4.9) — a chronological, read-only history of
 * status flips and edits for anything that isn't a room-night (that's
 * `LedgerEntry`'s job). Written to by every mutating router; read from here.
 */
export const auditRouter = createTRPCRouter({
  list: protectedProcedure
    .input(z.object({ entity: z.string(), entityId: z.string() }))
    .query(({ ctx, input }) =>
      ctx.db.auditEntry.findMany({
        where: { entity: input.entity, entityId: input.entityId },
        orderBy: { createdAt: "desc" },
        include: { actor: { select: { name: true, email: true } } },
      }),
    ),

  /**
   * A scouting entry's own status history, and every one of its category
   * contracts' status history, merged into one chronological list — on the
   * Properties tab, both live in the same expanded row.
   */
  forScoutingEntry: protectedProcedure
    .input(z.object({ scoutingEntryId: z.string() }))
    .query(async ({ ctx, input }) => {
      const contracts = await ctx.db.categoryContract.findMany({
        where: { scoutingEntryId: input.scoutingEntryId },
        select: { id: true },
      });

      const entries = await ctx.db.auditEntry.findMany({
        where: {
          OR: [
            { entity: "ScoutingEntry", entityId: input.scoutingEntryId },
            { entity: "CategoryContract", entityId: { in: contracts.map((c) => c.id) } },
          ],
        },
        orderBy: { createdAt: "desc" },
        include: { actor: { select: { name: true, email: true } } },
      });

      return entries;
    }),
});
