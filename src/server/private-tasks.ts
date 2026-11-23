import type { Prisma } from "generated/prisma";

/**
 * Private tasks (doc §2.8, the owner 2026-11-23): a task marked private is
 * seen by whoever made it, and nobody else. Every list of tasks asks this.
 */
export const visibleTo = (userId: string) => ({ OR: [{ private: false }, { createdById: userId }] }) satisfies Prisma.TaskWhereInput;
