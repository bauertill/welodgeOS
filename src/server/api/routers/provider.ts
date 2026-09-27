import { TRPCError } from "@trpc/server";
import { z } from "zod";

import { contractingFields } from "~/lib/contracting";
import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";
import { logAudit } from "~/server/audit";

/**
 * Providers (doc §3.9): the chain or group a property belongs to, with its own
 * contacts and contracting details for the rare group that signs one contract
 * for several of its hotels.
 */

const text = z.string().max(2000).optional();
const contracting = z.object(
  Object.fromEntries(contractingFields.map(({ key }) => [key, text])) as Record<
    (typeof contractingFields)[number]["key"],
    typeof text
  >,
);
const contactInput = z.object({
  name: z.string().trim().min(1, "A contact needs a name."),
  role: z.string().optional(),
  email: z.string().email("That email address does not look right.").optional().or(z.literal("")),
  phone: z.string().optional(),
});

const blank = (value: string | null | undefined) => (value?.trim() ? value.trim() : null);

export const providerRouter = createTRPCRouter({
  /** Every provider, with how many properties it has. */
  list: protectedProcedure.query(({ ctx }) =>
    ctx.db.provider.findMany({
      orderBy: { name: "asc" },
      include: { _count: { select: { properties: true } } },
    }),
  ),

  byId: protectedProcedure.input(z.object({ id: z.string() })).query(({ ctx, input }) =>
    ctx.db.provider.findUnique({
      where: { id: input.id },
      include: {
        contacts: { orderBy: { name: "asc" } },
        properties: { orderBy: { name: "asc" }, select: { id: true, name: true, city: true, type: true } },
      },
    }),
  ),

  create: protectedProcedure
    .input(z.object({ name: z.string().trim().min(1, "A provider needs a name.").max(200) }))
    .mutation(async ({ ctx, input }) => {
      const duplicate = await ctx.db.provider.findFirst({
        where: { name: { equals: input.name, mode: "insensitive" } },
      });
      if (duplicate) {
        throw new TRPCError({ code: "BAD_REQUEST", message: `"${duplicate.name}" is already a provider.` });
      }
      const created = await ctx.db.provider.create({ data: { name: input.name } });
      await logAudit(ctx.db, { actorId: ctx.session.user.id, entity: "Provider", entityId: created.id, summary: "Added" });
      return created;
    }),

  update: protectedProcedure
    .input(
      contracting.extend({
        id: z.string(),
        name: z.string().trim().min(1, "A provider needs a name.").max(200),
        website: text,
        notes: text,
        contacts: z.array(contactInput).default([]),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { id, contacts, name, website, notes, ...details } = input;
      const duplicate = await ctx.db.provider.findFirst({
        where: { id: { not: id }, name: { equals: name, mode: "insensitive" } },
      });
      if (duplicate) {
        throw new TRPCError({ code: "BAD_REQUEST", message: `"${duplicate.name}" is already a provider.` });
      }
      return ctx.db.$transaction(async (tx) => {
        await tx.providerContact.deleteMany({ where: { providerId: id } });
        const updated = await tx.provider.update({
          where: { id },
          data: {
            name,
            website: blank(website),
            notes: blank(notes),
            ...Object.fromEntries(Object.entries(details).map(([key, value]) => [key, blank(value)])),
            contacts: {
              create: contacts.map((contact) => ({
                name: contact.name.trim(),
                role: blank(contact.role),
                email: blank(contact.email),
                phone: blank(contact.phone),
              })),
            },
          },
        });
        await logAudit(tx, { actorId: ctx.session.user.id, entity: "Provider", entityId: id, summary: "Updated" });
        return updated;
      });
    }),

  /** Delete a provider. Its properties stay, with no provider. */
  remove: protectedProcedure.input(z.object({ id: z.string() })).mutation(async ({ ctx, input }) => {
    await ctx.db.provider.delete({ where: { id: input.id } });
    await logAudit(ctx.db, { actorId: ctx.session.user.id, entity: "Provider", entityId: input.id, summary: "Deleted" });
  }),
});
