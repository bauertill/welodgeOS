import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";

/** The We Lodge reps, for the owner pickers on both axes (doc §4.7). */
export const userRouter = createTRPCRouter({
  list: protectedProcedure.query(({ ctx }) =>
    ctx.db.user.findMany({
      orderBy: [{ name: "asc" }, { email: "asc" }],
      select: { id: true, name: true, email: true },
    }),
  ),
});
