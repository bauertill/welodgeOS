-- The IBC is a venue, not a kind of place (doc §3.7): "IBC" leaves the list of
-- kinds. Any place of interest recorded as one becomes a venue — its name,
-- address and position unchanged — before the kind is removed, so nothing is
-- lost. It then counts as a venue for "distance to the nearest venue".

UPDATE "PlaceOfInterest" SET "category" = 'VENUE' WHERE "category" = 'IBC';

-- AlterEnum: Postgres cannot drop a value from an enum, so the type is rebuilt.
ALTER TYPE "PlaceCategory" RENAME TO "PlaceCategory_old";
CREATE TYPE "PlaceCategory" AS ENUM ('VENUE', 'TRAIN_STATION', 'AIRPORT', 'OTHER');
ALTER TABLE "PlaceOfInterest" ALTER COLUMN "category" TYPE "PlaceCategory" USING ("category"::text::"PlaceCategory");
DROP TYPE "PlaceCategory_old";
