-- AlterTable
ALTER TABLE "RateCard" ADD COLUMN     "clientId" TEXT;

-- CreateIndex
CREATE INDEX "RateCard_clientId_idx" ON "RateCard"("clientId");

-- AddForeignKey
ALTER TABLE "RateCard" ADD CONSTRAINT "RateCard_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- A request's card is for its request's client (doc §4.11, 2026-11-17).
UPDATE "RateCard" AS card SET "clientId" = request."clientId" FROM "SalesRequest" AS request WHERE card."salesRequestId" = request."id" AND card."clientId" IS NULL;
