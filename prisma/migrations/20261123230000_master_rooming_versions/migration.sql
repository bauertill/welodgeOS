-- Versions become per property at the event — the master list (doc §6.9). Only test
-- versions existed (on staging); the rooming list was not yet live.
DELETE FROM "RoomingVersion";
-- DropForeignKey
ALTER TABLE "RoomingVersion" DROP CONSTRAINT "RoomingVersion_salesRequestId_fkey";

-- DropIndex
DROP INDEX "RoomingVersion_salesRequestId_propertyId_number_key";

-- AlterTable
ALTER TABLE "RoomingVersion" DROP COLUMN "salesRequestId",
ADD COLUMN     "eventId" TEXT NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "RoomingVersion_eventId_propertyId_number_key" ON "RoomingVersion"("eventId", "propertyId", "number");

-- AddForeignKey
ALTER TABLE "RoomingVersion" ADD CONSTRAINT "RoomingVersion_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

