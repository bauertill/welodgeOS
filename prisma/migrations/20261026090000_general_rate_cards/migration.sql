-- AlterTable
ALTER TABLE "RateCard" ADD COLUMN     "eventId" TEXT,
ALTER COLUMN "salesRequestId" DROP NOT NULL;

-- AlterTable
ALTER TABLE "RateCardResponse" ADD COLUMN     "company" TEXT,
ADD COLUMN     "salesRequestId" TEXT;

-- CreateIndex
CREATE INDEX "RateCard_eventId_idx" ON "RateCard"("eventId");

-- AddForeignKey
ALTER TABLE "RateCard" ADD CONSTRAINT "RateCard_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RateCardResponse" ADD CONSTRAINT "RateCardResponse_salesRequestId_fkey" FOREIGN KEY ("salesRequestId") REFERENCES "SalesRequest"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Every existing card is for its request's event; every existing answer is on its card's request.
UPDATE "RateCard" c SET "eventId" = r."eventId" FROM "SalesRequest" r WHERE r.id = c."salesRequestId" AND c."eventId" IS NULL;
UPDATE "RateCardResponse" a SET "salesRequestId" = c."salesRequestId" FROM "RateCard" c WHERE c.id = a."rateCardId" AND a."salesRequestId" IS NULL;
