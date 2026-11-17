-- The quote statuses are worked out, never set by hand (the owner, 2026-11-17,
-- doc §3.9): taken out of the hand-set list; any set by hand go back to automatic.
UPDATE "ScoutingEntry" SET "detail" = NULL WHERE "detail" IN ('QUOTE_REQUESTED', 'QUOTE_RECEIVED', 'QUOTE_EXPIRED');
CREATE TYPE "ScoutingDetail_new" AS ENUM ('RATE_TBC', 'NO_AVAILABILITY', 'OFFICIAL_HOTEL', 'UNDER_CONSTRUCTION');
ALTER TABLE "ScoutingEntry" ALTER COLUMN "detail" TYPE "ScoutingDetail_new" USING ("detail"::text::"ScoutingDetail_new");
ALTER TYPE "ScoutingDetail" RENAME TO "ScoutingDetail_old";
ALTER TYPE "ScoutingDetail_new" RENAME TO "ScoutingDetail";
DROP TYPE "ScoutingDetail_old";
