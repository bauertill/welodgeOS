import type { PrismaClient } from "generated/prisma";
import { TRPCError } from "@trpc/server";
import { z } from "zod";

import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";
import { logAudit } from "~/server/audit";

/**
 * Team tags (doc §2.7, the owner 2026-11-19: "team tags, for example @LA …
 * then it sends a notification to everybody instead of having to tag each
 * individual person"). Anyone signed in makes, changes or deletes one on the
 * Team page; @[LA] in an update, reply, task or comment then tells each member.
 */
const nameInput = z
  .string()
  .trim()
  .min(1, "A team tag needs a name.")
  .max(40, "Keep the name short — it is typed after @.")
  .refine((name) => !/[[\]@]/.test(name), "A team tag's name cannot contain @ or square brackets.");

async function refuseClash(db: PrismaClient, name: string, id?: string) {
  const tag = await db.teamTag.findFirst({ where: { name: { equals: name, mode: "insensitive" }, ...(id && { id: { not: id } }) }, select: { name: true } });
  if (tag) throw new TRPCError({ code: "BAD_REQUEST", message: `There is already a team tag called "${tag.name}".` });
  const person = await db.user.findFirst({ where: { name: { equals: name, mode: "insensitive" } }, select: { name: true } });
  if (person) throw new TRPCError({ code: "BAD_REQUEST", message: `"${person.name}" is a colleague's name — choose another, so @${name} means one thing.` });
}

export const teamTagRouter = createTRPCRouter({
  /** Every team tag and its members, A to Z. */
  list: protectedProcedure.query(({ ctx }) =>
    ctx.db.teamTag.findMany({
      orderBy: { name: "asc" },
      select: { id: true, name: true, members: { select: { id: true, name: true, email: true }, orderBy: { name: "asc" } } },
    }),
  ),

  /** Make a team tag, or (with an id) rename it and change who is in it. */
  save: protectedProcedure
    .input(z.object({ id: z.string().optional(), name: nameInput, memberIds: z.array(z.string()).min(1, "Put at least one person in it.") }))
    .mutation(async ({ ctx, input }) => {
      await refuseClash(ctx.db, input.name, input.id);
      const members = input.memberIds.map((id) => ({ id }));
      const tag = input.id
        ? await ctx.db.teamTag.update({ where: { id: input.id }, data: { name: input.name, members: { set: members } } })
        : await ctx.db.teamTag.create({ data: { name: input.name, members: { connect: members } } });
      await logAudit(ctx.db, { actorId: ctx.session.user.id, entity: "TeamTag", entityId: tag.id, summary: `${input.id ? "Changed" : "Made"} @${tag.name} (${input.memberIds.length} ${input.memberIds.length === 1 ? "person" : "people"})` });
      return tag;
    }),

  /** Delete a team tag. Posts that used it keep the words; nobody new is told. */
  remove: protectedProcedure.input(z.object({ id: z.string() })).mutation(async ({ ctx, input }) => {
    const tag = await ctx.db.teamTag.delete({ where: { id: input.id } });
    await logAudit(ctx.db, { actorId: ctx.session.user.id, entity: "TeamTag", entityId: tag.id, summary: `Deleted @${tag.name}` });
  }),
});
