-- AlterTable
ALTER TABLE "RoomSlot" ADD COLUMN     "unitNumber" TEXT;

-- AlterTable
ALTER TABLE "SalesRequest" ADD COLUMN     "roomingLinkMadeAt" TIMESTAMP(3),
ADD COLUMN     "roomingToken" TEXT;

-- CreateTable
CREATE TABLE "RoomingStay" (
    "id" TEXT NOT NULL,
    "salesRequestId" TEXT NOT NULL,
    "slotId" TEXT NOT NULL,
    "checkIn" DATE NOT NULL,
    "checkOut" DATE NOT NULL,
    "guests" JSONB NOT NULL DEFAULT '[]',
    "arrival" TEXT,
    "notes" TEXT,
    "removedAt" TIMESTAMP(3),
    "changedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RoomingStay_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RoomingSent" (
    "id" TEXT NOT NULL,
    "salesRequestId" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sentById" TEXT,

    CONSTRAINT "RoomingSent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RoomingStay_salesRequestId_idx" ON "RoomingStay"("salesRequestId");

-- CreateIndex
CREATE INDEX "RoomingStay_slotId_idx" ON "RoomingStay"("slotId");

-- CreateIndex
CREATE UNIQUE INDEX "RoomingSent_salesRequestId_propertyId_key" ON "RoomingSent"("salesRequestId", "propertyId");

-- CreateIndex
CREATE UNIQUE INDEX "SalesRequest_roomingToken_key" ON "SalesRequest"("roomingToken");

-- AddForeignKey
ALTER TABLE "RoomingStay" ADD CONSTRAINT "RoomingStay_salesRequestId_fkey" FOREIGN KEY ("salesRequestId") REFERENCES "SalesRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RoomingStay" ADD CONSTRAINT "RoomingStay_slotId_fkey" FOREIGN KEY ("slotId") REFERENCES "RoomSlot"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RoomingStay" ADD CONSTRAINT "RoomingStay_changedById_fkey" FOREIGN KEY ("changedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RoomingSent" ADD CONSTRAINT "RoomingSent_salesRequestId_fkey" FOREIGN KEY ("salesRequestId") REFERENCES "SalesRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RoomingSent" ADD CONSTRAINT "RoomingSent_sentById_fkey" FOREIGN KEY ("sentById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

