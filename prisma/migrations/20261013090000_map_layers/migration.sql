-- Map layers (doc §3.7): each event's places of interest in named, coloured layers,
-- shown or hidden together, distances measured to the layers that say so.
-- AlterTable
ALTER TABLE "PlaceOfInterest" ADD COLUMN     "layerId" TEXT;

-- CreateTable
CREATE TABLE "MapLayer" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "color" TEXT NOT NULL,
    "measured" BOOLEAN NOT NULL DEFAULT false,
    "position" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MapLayer_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MapLayer_eventId_position_idx" ON "MapLayer"("eventId", "position");

-- CreateIndex
CREATE UNIQUE INDEX "MapLayer_eventId_name_key" ON "MapLayer"("eventId", "name");

-- AddForeignKey
ALTER TABLE "MapLayer" ADD CONSTRAINT "MapLayer_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlaceOfInterest" ADD CONSTRAINT "PlaceOfInterest_layerId_fkey" FOREIGN KEY ("layerId") REFERENCES "MapLayer"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Every place carried over into a layer of its kind. Venues are measured to,
-- as distances were before; the rest are for looking at until said otherwise.
INSERT INTO "MapLayer" ("id", "eventId", "name", "color", "measured", "position")
SELECT 'ml_' || md5(p."eventId" || p."category"::text), p."eventId",
  CASE p."category"::text WHEN 'VENUE' THEN 'Venues' WHEN 'TRAIN_STATION' THEN 'Train stations' WHEN 'AIRPORT' THEN 'Airports' ELSE 'Other places' END,
  CASE p."category"::text WHEN 'VENUE' THEN '#9b1c31' WHEN 'TRAIN_STATION' THEN '#1d5fa8' WHEN 'AIRPORT' THEN '#0a7a47' ELSE '#8a5a00' END,
  p."category"::text = 'VENUE',
  CASE p."category"::text WHEN 'VENUE' THEN 0 WHEN 'TRAIN_STATION' THEN 1 WHEN 'AIRPORT' THEN 2 ELSE 3 END
FROM (SELECT DISTINCT "eventId", "category" FROM "PlaceOfInterest") p;

UPDATE "PlaceOfInterest" SET "layerId" = 'ml_' || md5("eventId" || "category"::text);
