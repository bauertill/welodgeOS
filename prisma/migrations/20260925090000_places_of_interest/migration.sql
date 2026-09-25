-- An event used to carry one venue, in three columns of its own. It now
-- carries as many places of interest as it needs (doc §3.7).
--
-- The order below matters: the new table is created and the old venues are
-- copied into it *before* the columns are dropped, so no venue is lost. A
-- venue with a name but no coordinates cannot become a place of interest —
-- a place that cannot be located is of no use — so it is left behind
-- deliberately rather than invented.

-- CreateEnum
CREATE TYPE "PlaceCategory" AS ENUM ('VENUE', 'TRAIN_STATION', 'AIRPORT', 'IBC', 'OTHER');

-- CreateTable
CREATE TABLE "PlaceOfInterest" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" "PlaceCategory" NOT NULL,
    "lines" TEXT,
    "address" TEXT,
    "latitude" DOUBLE PRECISION NOT NULL,
    "longitude" DOUBLE PRECISION NOT NULL,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "eventId" TEXT NOT NULL,

    CONSTRAINT "PlaceOfInterest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PlaceOfInterest_eventId_category_idx" ON "PlaceOfInterest"("eventId", "category");

-- CreateIndex
CREATE UNIQUE INDEX "PlaceOfInterest_eventId_name_key" ON "PlaceOfInterest"("eventId", "name");

-- AddForeignKey
ALTER TABLE "PlaceOfInterest" ADD CONSTRAINT "PlaceOfInterest_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Carry every locatable venue across as a place of interest.
INSERT INTO "PlaceOfInterest" ("id", "name", "category", "latitude", "longitude", "createdAt", "updatedAt", "eventId")
SELECT
    gen_random_uuid()::text,
    COALESCE(NULLIF(TRIM("venueName"), ''), 'Venue'),
    'VENUE',
    "venueLatitude",
    "venueLongitude",
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP,
    "id"
FROM "Event"
WHERE "venueLatitude" IS NOT NULL AND "venueLongitude" IS NOT NULL;

-- AlterTable
ALTER TABLE "Event" DROP COLUMN "venueLatitude",
DROP COLUMN "venueLongitude",
DROP COLUMN "venueName";
