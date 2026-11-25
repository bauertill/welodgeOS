-- A research hotel's stars on its map point (doc §3.7, the owner 2026-11-25).
ALTER TABLE "PlaceOfInterest" ADD COLUMN "stars" INTEGER;

-- "5* Fairmont Breakers" → stars 5, named "Fairmont Breakers".
UPDATE "PlaceOfInterest" SET "stars" = substring("name" from '^\s*([1-5])\s*\*')::int WHERE "name" ~ '^\s*[1-5]\s*\*';

-- The name without its stars — unless the event's map already has that name, or two would end up with it: those keep theirs.
WITH bare AS (
  SELECT "id", "eventId", btrim(regexp_replace("name", '^\s*[1-5]\s*\*\s*', '')) AS "plain",
         row_number() OVER (PARTITION BY "eventId", btrim(regexp_replace("name", '^\s*[1-5]\s*\*\s*', '')) ORDER BY "createdAt", "id") AS "n"
  FROM "PlaceOfInterest" WHERE "name" ~ '^\s*[1-5]\s*\*'
)
UPDATE "PlaceOfInterest" p SET "name" = bare."plain"
FROM bare
WHERE p."id" = bare."id" AND bare."n" = 1 AND bare."plain" <> ''
  AND NOT EXISTS (SELECT 1 FROM "PlaceOfInterest" o WHERE o."eventId" = bare."eventId" AND o."name" = bare."plain");
