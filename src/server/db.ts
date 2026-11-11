import { env } from "~/env";
import { PrismaClient } from "../../generated/prisma";

const createPrismaClient = () =>
  new PrismaClient({
    log:
      env.NODE_ENV === "development" ? ["query", "error", "warn"] : ["error"],
    // The site runs in Washington and the database in Frankfurt, so every query
    // is a trip across the Atlantic. Saving a request's details for the first
    // time (its sourcing task, notices, history) took just over Prisma's
    // 5-second default and was rolled back (2026-11-11). Room to finish.
    transactionOptions: { maxWait: 10_000, timeout: 30_000 },
  });

const globalForPrisma = globalThis as unknown as {
  prisma: ReturnType<typeof createPrismaClient> | undefined;
};

export const db = globalForPrisma.prisma ?? createPrismaClient();

if (env.NODE_ENV !== "production") globalForPrisma.prisma = db;
