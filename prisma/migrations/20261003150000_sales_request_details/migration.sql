-- Sales requests in detail (doc §4.11): a request starts as an enquiry and
-- becomes a sales request once its details are in — rooms, period, budget,
-- where to be close to, the client's comments — given after a call or by the
-- client through a needs link. Each person can keep a booking link for calls.
-- New notifications: follow-up reminders and what clients send in.

-- CreateEnum
CREATE TYPE "BudgetBasis" AS ENUM ('PER_ROOM_NIGHT', 'PER_PERSON_NIGHT', 'TOTAL');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "NotificationKind" ADD VALUE 'SALES_FOLLOW_UP';
ALTER TYPE "NotificationKind" ADD VALUE 'SALES_NEEDS_SENT';
ALTER TYPE "NotificationKind" ADD VALUE 'SALES_CONTRACTING_SENT';

-- AlterTable
ALTER TABLE "SalesRequest" ADD COLUMN     "budgetBasis" "BudgetBasis",
ADD COLUMN     "budgetCents" INTEGER,
ADD COLUMN     "budgetCurrency" TEXT,
ADD COLUMN     "checkIn" DATE,
ADD COLUMN     "checkOut" DATE,
ADD COLUMN     "clientComments" TEXT,
ADD COLUMN     "closeToOther" TEXT,
ADD COLUMN     "detailedAt" TIMESTAMP(3),
ADD COLUMN     "needsLinkMadeAt" TIMESTAMP(3),
ADD COLUMN     "needsSubmittedAt" TIMESTAMP(3),
ADD COLUMN     "needsToken" TEXT,
ADD COLUMN     "roomCount" INTEGER;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "bookingLink" TEXT;

-- CreateTable
CREATE TABLE "_SalesRequestCloseTo" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,

    CONSTRAINT "_SalesRequestCloseTo_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateIndex
CREATE INDEX "_SalesRequestCloseTo_B_index" ON "_SalesRequestCloseTo"("B");

-- CreateIndex
CREATE UNIQUE INDEX "SalesRequest_needsToken_key" ON "SalesRequest"("needsToken");

-- AddForeignKey
ALTER TABLE "_SalesRequestCloseTo" ADD CONSTRAINT "_SalesRequestCloseTo_A_fkey" FOREIGN KEY ("A") REFERENCES "PlaceOfInterest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_SalesRequestCloseTo" ADD CONSTRAINT "_SalesRequestCloseTo_B_fkey" FOREIGN KEY ("B") REFERENCES "SalesRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Requests already past the first enquiry — moved on from Initial interest, or
-- with their rooms, period or budget written down — count as sales requests
-- from the day they were registered; the rest stay enquiries.
UPDATE "SalesRequest"
SET "detailedAt" = "createdAt"
WHERE "stage" <> 'INITIAL_INTEREST'
   OR NULLIF(TRIM("rooms"), '') IS NOT NULL
   OR NULLIF(TRIM("period"), '') IS NOT NULL
   OR NULLIF(TRIM("budget"), '') IS NOT NULL;
