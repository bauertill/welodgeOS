-- The status menu becomes Automatic, Do not disturb and Set as away (doc §2.7).
-- At lunch and Done for the day stop being dot statuses and become ready-made
-- statuses in a person's own words instead, keeping the time they run out.
--
-- The order matters: anyone at lunch or done for the day right now is carried
-- across to the matching own-words status *before* those values are removed,
-- so nobody's status vanishes. Someone who already has an own-words status
-- keeps it; theirs is not overwritten.

UPDATE "User"
SET "customStatusEmoji" = '🥪', "customStatusText" = 'At lunch', "customStatusUntil" = "statusUntil"
WHERE "status" = 'AT_LUNCH' AND "customStatusText" IS NULL
  AND ("statusUntil" IS NULL OR "statusUntil" > now());

UPDATE "User"
SET "customStatusEmoji" = '🌙', "customStatusText" = 'Done for the day', "customStatusUntil" = "statusUntil"
WHERE "status" = 'DONE_FOR_THE_DAY' AND "customStatusText" IS NULL
  AND ("statusUntil" IS NULL OR "statusUntil" > now());

UPDATE "User" SET "status" = NULL, "statusUntil" = NULL
WHERE "status" IN ('AT_LUNCH', 'DONE_FOR_THE_DAY');

-- AlterEnum: Postgres cannot drop a value from an enum, so the type is rebuilt.
ALTER TYPE "UserStatus" RENAME TO "UserStatus_old";
CREATE TYPE "UserStatus" AS ENUM ('AWAY', 'DO_NOT_DISTURB');
ALTER TABLE "User" ALTER COLUMN "status" TYPE "UserStatus" USING ("status"::text::"UserStatus");
DROP TYPE "UserStatus_old";
