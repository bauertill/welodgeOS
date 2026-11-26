import type { Prisma, TaskStatus } from "generated/prisma";

/**
 * A defect's task moved on (doc §6.10): done means the defect is fixed and
 * waits to be checked; reopened, it is to fix again. Called from the task's own
 * update, so it holds however the task is moved — board, list or Claude.
 */
export async function settleDefectForTask(tx: Prisma.TransactionClient, taskId: string, status: TaskStatus) {
  const defect = await tx.defect.findUnique({ where: { taskId }, select: { id: true, status: true } });
  if (!defect) return;
  if (status === "DONE" && defect.status === "OPEN") await tx.defect.update({ where: { id: defect.id }, data: { status: "FIXED", fixedAt: new Date() } });
  if (status !== "DONE" && defect.status === "FIXED") await tx.defect.update({ where: { id: defect.id }, data: { status: "OPEN", fixedAt: null } });
}
