import { z } from "zod";

import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";
import { logAudit, logFieldChanges } from "~/server/audit";

const eventInput = z.object({
  name: z.string().min(1, "An event needs a name"),
  city: z.string().optional(),
  country: z.string().optional(),
  startDate: z.date(),
  endDate: z.date(),
  status: z.enum(["PLANNING", "ACTIVE", "CLOSED"]).default("PLANNING"),
});

export const eventRouter = createTRPCRouter({
  list: protectedProcedure.query(({ ctx }) =>
    ctx.db.event.findMany({
      orderBy: { startDate: "asc" },
      include: {
        // Venues are places of interest now (doc §3.7), and the list names
        // them under the event.
        placesOfInterest: {
          where: { category: "VENUE" },
          orderBy: { name: "asc" },
          select: { id: true, name: true },
        },
        _count: { select: { scoutingEntries: true, roomNights: true } },
      },
    }),
  ),

  byId: protectedProcedure
    .input(z.object({ id: z.string() }))
    .query(({ ctx, input }) =>
      ctx.db.event.findUnique({
        where: { id: input.id },
        include: {
          placesOfInterest: {
            orderBy: [{ category: "asc" }, { name: "asc" }],
          },
        },
      }),
    ),

  create: protectedProcedure
    .input(eventInput)
    .mutation(({ ctx, input }) =>
      ctx.db.$transaction(async (tx) => {
        const event = await tx.event.create({
          data: {
            ...input,
            city: input.city?.trim() || null,
            country: input.country?.trim() || null,
          },
        });
        await logAudit(tx, {
          actorId: ctx.session.user.id,
          entity: "Event",
          entityId: event.id,
          summary: "Created",
        });
        return event;
      }),
    ),

  update: protectedProcedure
    .input(eventInput.extend({ id: z.string() }))
    .mutation(({ ctx, input }) =>
      ctx.db.$transaction(async (tx) => {
        const { id, ...data } = input;
        const before = await tx.event.findUniqueOrThrow({ where: { id } });
        const updated = await tx.event.update({ where: { id }, data });
        await logFieldChanges(
          tx,
          { actorId: ctx.session.user.id, entity: "Event", entityId: id, summary: "Updated" },
          before,
          updated,
          [
            { key: "name", label: "Name" },
            { key: "city", label: "City" },
            { key: "country", label: "Country" },
            { key: "startDate", label: "Start date" },
            { key: "endDate", label: "End date" },
            { key: "status", label: "Status" },
          ],
        );
        return updated;
      }),
    ),
});
