-- Notifications (doc §2.9): what each person should know about — given a task,
-- a comment or mention, a status change, a deadline — under the bell, and by
-- email as each person chooses (default: one summary a day).

-- CreateEnum
CREATE TYPE "NotificationKind" AS ENUM ('TASK_ASSIGNED', 'TASK_COMMENT', 'TASK_MENTION', 'TASK_STATUS', 'TASK_DUE_SOON', 'TASK_OVERDUE');

-- CreateEnum
CREATE TYPE "EmailPreference" AS ENUM ('IMMEDIATE', 'DAILY', 'NONE');

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "emailNotifications" "EmailPreference" NOT NULL DEFAULT 'DAILY';

-- CreateTable
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL,
    "kind" "NotificationKind" NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT,
    "link" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "actorId" TEXT,
    "taskId" TEXT,
    "readAt" TIMESTAMP(3),
    "emailedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Notification_userId_readAt_idx" ON "Notification"("userId", "readAt");

-- CreateIndex
CREATE INDEX "Notification_userId_emailedAt_idx" ON "Notification"("userId", "emailedAt");

-- CreateIndex
CREATE INDEX "Notification_taskId_kind_idx" ON "Notification"("taskId", "kind");

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE CASCADE ON UPDATE CASCADE;

