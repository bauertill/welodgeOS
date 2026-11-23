-- AlterTable
ALTER TABLE "Task" ADD COLUMN     "private" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
CREATE INDEX "Task_private_createdById_idx" ON "Task"("private", "createdById");
