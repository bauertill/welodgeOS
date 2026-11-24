-- AlterEnum
ALTER TYPE "NotificationKind" ADD VALUE 'ROOMING_SUBMITTED';

-- AlterTable
ALTER TABLE "RoomingVersion" ADD COLUMN     "message" TEXT,
ADD COLUMN     "sentTo" TEXT;

-- CreateTable
CREATE TABLE "RoomingSubmission" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "salesRequestId" TEXT,
    "number" INTEGER NOT NULL,
    "stays" JSONB NOT NULL,
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "submittedById" TEXT,

    CONSTRAINT "RoomingSubmission_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "RoomingSubmission_eventId_clientId_number_key" ON "RoomingSubmission"("eventId", "clientId", "number");

-- AddForeignKey
ALTER TABLE "RoomingSubmission" ADD CONSTRAINT "RoomingSubmission_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RoomingSubmission" ADD CONSTRAINT "RoomingSubmission_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RoomingSubmission" ADD CONSTRAINT "RoomingSubmission_salesRequestId_fkey" FOREIGN KEY ("salesRequestId") REFERENCES "SalesRequest"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RoomingSubmission" ADD CONSTRAINT "RoomingSubmission_submittedById_fkey" FOREIGN KEY ("submittedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

