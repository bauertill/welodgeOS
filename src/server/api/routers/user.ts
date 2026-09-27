import { PhoneKind, UserStatus } from "generated/prisma";
import { z } from "zod";

import { customStatusMaxLength, customStatusOf, presenceOf } from "~/lib/team";
import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";

/** A time limit must still be ahead of us, and within a year. */
const futureDate = z
  .date()
  .refine((date) => date.getTime() > Date.now(), "That time has already passed.")
  .refine(
    (date) => date.getTime() < Date.now() + 366 * 24 * 60 * 60 * 1000,
    "Choose a time within the next year.",
  );

/** A person as the screen needs them: their dot and their status, worked out now. */
function withStatus<
  T extends Parameters<typeof presenceOf>[0] & Parameters<typeof customStatusOf>[0],
>(person: T) {
  const presence = presenceOf(person);
  return {
    ...person,
    presence,
    // When the dot goes back to automatic, if it was set by hand with a limit.
    presenceUntil: presence === person.status ? person.statusUntil : null,
    customStatus: customStatusOf(person),
  };
}

const profileSelect = {
  id: true,
  name: true,
  email: true,
  image: true,
  jobTitle: true,
  lastSeenAt: true,
  status: true,
  statusUntil: true,
  customStatusEmoji: true,
  customStatusText: true,
  customStatusUntil: true,
  phones: {
    orderBy: { position: "asc" },
    select: { id: true, number: true, kind: true },
  },
} as const;

export const userRouter = createTRPCRouter({
  /** The We Lodge reps, for the owner pickers on both axes (doc §4.7). */
  list: protectedProcedure.query(({ ctx }) =>
    ctx.db.user.findMany({
      orderBy: [{ name: "asc" }, { email: "asc" }],
      select: { id: true, name: true, email: true },
    }),
  ),

  /** The team directory: everyone's contact details (doc §2.7). */
  directory: protectedProcedure.query(async ({ ctx }) => {
    const people = await ctx.db.user.findMany({
      orderBy: [{ name: "asc" }, { email: "asc" }],
      select: profileSelect,
    });
    return people.map(withStatus);
  }),

  /** The signed-in person's own profile. */
  me: protectedProcedure.query(async ({ ctx }) => {
    const me = await ctx.db.user.findUniqueOrThrow({
      where: { id: ctx.session.user.id },
      select: profileSelect,
    });
    return withStatus(me);
  }),

  /** "I am still here" — sent by an open tab while its person is using it. */
  heartbeat: protectedProcedure.mutation(async ({ ctx }) => {
    await ctx.db.user.update({
      where: { id: ctx.session.user.id },
      data: { lastSeenAt: new Date() },
    });
  }),

  /**
   * Set a status by hand, or go back to automatic with `null`. At lunch and
   * Done for the day always carry the time they run out; Do not disturb may.
   */
  setStatus: protectedProcedure
    .input(
      z
        .object({ status: z.nativeEnum(UserStatus).nullable(), until: futureDate.nullable() })
        .refine((value) => value.status !== "AT_LUNCH" || value.until, {
          message: "Say how long you will be at lunch.",
        }),
    )
    .mutation(async ({ ctx, input }) => {
      await ctx.db.user.update({
        where: { id: ctx.session.user.id },
        data: {
          status: input.status,
          statusUntil: input.status ? input.until : null,
          // Choosing a status is itself using the system.
          lastSeenAt: new Date(),
        },
      });
    }),

  /** A status in your own words, with an emoji; `null` clears it. */
  setCustomStatus: protectedProcedure
    .input(
      z
        .object({
          emoji: z.string().trim().min(1).max(16),
          text: z
            .string()
            .trim()
            .min(1, "Write a status, or clear it.")
            .max(customStatusMaxLength, `A status can be at most ${customStatusMaxLength} characters.`),
          until: futureDate.nullable(),
        })
        .nullable(),
    )
    .mutation(async ({ ctx, input }) => {
      await ctx.db.user.update({
        where: { id: ctx.session.user.id },
        data: {
          customStatusEmoji: input?.emoji ?? null,
          customStatusText: input?.text ?? null,
          customStatusUntil: input?.until ?? null,
        },
      });
    }),

  /**
   * Save one's own profile. Nobody can edit somebody else's, and the email is
   * not editable at all: it is the Google account the person signs in with.
   * Phone numbers are replaced as a list, in the order given.
   */
  updateProfile: protectedProcedure
    .input(
      z.object({
        name: z.string().trim().min(1, "Please enter your name.").max(120),
        jobTitle: z.string().trim().max(120),
        phones: z
          .array(
            z.object({
              number: z
                .string()
                .trim()
                .min(1, "A phone number cannot be empty.")
                .max(40)
                .regex(/^[+0-9 ()./-]+$/, "A phone number can only hold digits, spaces and + ( ) - . /"),
              kind: z.nativeEnum(PhoneKind),
            }),
          )
          .max(20),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      await ctx.db.$transaction([
        ctx.db.userPhone.deleteMany({ where: { userId } }),
        ctx.db.user.update({
          where: { id: userId },
          data: {
            name: input.name,
            jobTitle: input.jobTitle || null,
            phones: {
              create: input.phones.map((phone, position) => ({ ...phone, position })),
            },
          },
        }),
      ]);
      return ctx.db.user.findUniqueOrThrow({ where: { id: userId }, select: profileSelect });
    }),
});
