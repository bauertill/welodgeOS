-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "NotificationKind" ADD VALUE 'PAYMENT_DUE';
ALTER TYPE "NotificationKind" ADD VALUE 'CANCELLATION_DUE';

-- AlterTable
ALTER TABLE "Contract" ADD COLUMN     "reminderDays" INTEGER[] DEFAULT ARRAY[30, 7, 0]::INTEGER[];

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "overdueSentAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "DeadlineReminderSent" (
    "key" TEXT NOT NULL,
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DeadlineReminderSent_pkey" PRIMARY KEY ("key")
);

