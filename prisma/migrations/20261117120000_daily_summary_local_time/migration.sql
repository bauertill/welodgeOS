-- AlterTable
ALTER TABLE "User" ADD COLUMN     "dailySummary" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "summarySentAt" TIMESTAMP(3),
ADD COLUMN     "timeZone" TEXT;

