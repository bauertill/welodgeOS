-- Versions replace the single "sent" marker (doc §6.9). RoomingSent only ever
-- held test data on staging; the rooming list was not yet live.
-- DropForeignKey
ALTER TABLE "RoomingSent" DROP CONSTRAINT "RoomingSent_salesRequestId_fkey";

-- DropForeignKey
ALTER TABLE "RoomingSent" DROP CONSTRAINT "RoomingSent_sentById_fkey";

-- AlterTable
ALTER TABLE "RoomingStay" ADD COLUMN     "extraAskedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "SalesRequest" ADD COLUMN     "roomingFields" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- DropTable
DROP TABLE "RoomingSent";

-- CreateTable
CREATE TABLE "RoomingVersion" (
    "id" TEXT NOT NULL,
    "salesRequestId" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "stays" JSONB NOT NULL,
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sentById" TEXT,

    CONSTRAINT "RoomingVersion_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "RoomingVersion_salesRequestId_propertyId_number_key" ON "RoomingVersion"("salesRequestId", "propertyId", "number");

-- AddForeignKey
ALTER TABLE "RoomingVersion" ADD CONSTRAINT "RoomingVersion_salesRequestId_fkey" FOREIGN KEY ("salesRequestId") REFERENCES "SalesRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RoomingVersion" ADD CONSTRAINT "RoomingVersion_sentById_fkey" FOREIGN KEY ("sentById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

