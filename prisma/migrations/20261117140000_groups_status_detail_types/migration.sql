-- The team's feedback, 2026-11-17 (doc §3.1, §3.9): groups set by hand, a
-- status beneath them for the detail, and more property types.

-- The detail beneath the group.
CREATE TYPE "ScoutingDetail" AS ENUM ('QUOTE_REQUESTED', 'QUOTE_RECEIVED', 'QUOTE_EXPIRED', 'RATE_TBC', 'NO_AVAILABILITY', 'OFFICIAL_HOTEL', 'UNDER_CONSTRUCTION');
ALTER TABLE "ScoutingEntry" ADD COLUMN "detail" "ScoutingDetail";

-- "Organising committee" is no longer a group of its own: those properties are
-- ruled out for us, with "Official hotel" as their detail.
UPDATE "ScoutingEntry" SET "detail" = 'OFFICIAL_HOTEL', "status" = 'REJECTED' WHERE "status" = 'ORGANISER';

CREATE TYPE "ScoutingStatus_new" AS ENUM ('PROSPECT', 'CONTACTED', 'SHORTLISTED', 'REJECTED', 'CONTRACTED');
ALTER TABLE "ScoutingEntry" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "ScoutingEntry" ALTER COLUMN "status" TYPE "ScoutingStatus_new" USING ("status"::text::"ScoutingStatus_new");
ALTER TYPE "ScoutingStatus" RENAME TO "ScoutingStatus_old";
ALTER TYPE "ScoutingStatus_new" RENAME TO "ScoutingStatus";
DROP TYPE "ScoutingStatus_old";
ALTER TABLE "ScoutingEntry" ALTER COLUMN "status" SET DEFAULT 'PROSPECT';

-- More property types; existing apartments stay "Apartment" until sorted by hand.
ALTER TYPE "PropertyType" ADD VALUE 'GUEST_HOUSE';
ALTER TYPE "PropertyType" ADD VALUE 'INDIVIDUAL_HOME';
ALTER TYPE "PropertyType" ADD VALUE 'RESORT_LODGE';
ALTER TYPE "PropertyType" ADD VALUE 'FURNISHED_APARTMENT';
ALTER TYPE "PropertyType" ADD VALUE 'UNFURNISHED_APARTMENT';
