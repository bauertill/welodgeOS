-- A room-night held for a client, and a client's request on a night, can say
-- which of the client's sales requests it belongs to (doc §4.11). Existing
-- holds and requests belong to none until someone ties them to one.

-- AlterTable
ALTER TABLE "RoomNight" ADD COLUMN     "salesRequestId" TEXT;

-- AlterTable
ALTER TABLE "RoomNightRequest" ADD COLUMN     "salesRequestId" TEXT;

-- CreateIndex
CREATE INDEX "RoomNight_salesRequestId_idx" ON "RoomNight"("salesRequestId");

-- CreateIndex
CREATE INDEX "RoomNightRequest_salesRequestId_idx" ON "RoomNightRequest"("salesRequestId");

-- AddForeignKey
ALTER TABLE "RoomNight" ADD CONSTRAINT "RoomNight_salesRequestId_fkey" FOREIGN KEY ("salesRequestId") REFERENCES "SalesRequest"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RoomNightRequest" ADD CONSTRAINT "RoomNightRequest_salesRequestId_fkey" FOREIGN KEY ("salesRequestId") REFERENCES "SalesRequest"("id") ON DELETE SET NULL ON UPDATE CASCADE;

