-- A map layer shown under our Hotels or Apartments, ticked with it (doc §3.7, 2026-11-25).
ALTER TABLE "MapLayer" ADD COLUMN "groupedWith" TEXT;

-- The owner, 2026-11-25: "merge Hotels (research) with Hotels, and the same for apartments".
UPDATE "MapLayer" SET "groupedWith" = 'hotels' WHERE "name" = 'Hotels (research)';
UPDATE "MapLayer" SET "groupedWith" = 'apartments' WHERE "name" = 'Apartments (research)';
