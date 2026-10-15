-- An event's team (doc §2.3): its project lead, and its accommodation managers —
-- who are given each new sales request's sourcing task (doc §4.11), the project
-- lead being told. A new notification for that.

-- AlterEnum
ALTER TYPE "NotificationKind" ADD VALUE 'SALES_NEW_REQUEST';

-- AlterTable
ALTER TABLE "Event" ADD COLUMN     "projectLeadId" TEXT;

-- CreateTable
CREATE TABLE "_EventAccommodationManagers" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,

    CONSTRAINT "_EventAccommodationManagers_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateIndex
CREATE INDEX "_EventAccommodationManagers_B_index" ON "_EventAccommodationManagers"("B");

-- AddForeignKey
ALTER TABLE "Event" ADD CONSTRAINT "Event_projectLeadId_fkey" FOREIGN KEY ("projectLeadId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_EventAccommodationManagers" ADD CONSTRAINT "_EventAccommodationManagers_A_fkey" FOREIGN KEY ("A") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_EventAccommodationManagers" ADD CONSTRAINT "_EventAccommodationManagers_B_fkey" FOREIGN KEY ("B") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

