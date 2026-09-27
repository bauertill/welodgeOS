-- Groups on an event's Properties tab (doc §3.9): named, colour-coded, per
-- event, and independent of status. Every property already on a list starts
-- in no group. Purely additive.

-- CreateEnum
CREATE TYPE "GroupColour" AS ENUM ('PURPLE', 'BLUE', 'TEAL', 'GREEN', 'LIME', 'YELLOW', 'ORANGE', 'RED', 'PINK', 'GREY');

-- AlterTable
ALTER TABLE "ScoutingEntry" ADD COLUMN     "groupId" TEXT;

-- CreateTable
CREATE TABLE "PropertyGroup" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "colour" "GroupColour" NOT NULL DEFAULT 'PURPLE',
    "position" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "eventId" TEXT NOT NULL,

    CONSTRAINT "PropertyGroup_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PropertyGroup_eventId_idx" ON "PropertyGroup"("eventId");

-- AddForeignKey
ALTER TABLE "ScoutingEntry" ADD CONSTRAINT "ScoutingEntry_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "PropertyGroup"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PropertyGroup" ADD CONSTRAINT "PropertyGroup_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;
