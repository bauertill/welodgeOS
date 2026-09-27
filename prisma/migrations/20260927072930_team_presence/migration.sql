-- Presence in the team section (doc §2.7): when each person last used the
-- system, a status they can set by hand with the time it runs out, and a
-- status in their own words with an emoji. Purely additive.

-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('AT_LUNCH', 'DONE_FOR_THE_DAY', 'DO_NOT_DISTURB');

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "lastSeenAt" TIMESTAMP(3),
ADD COLUMN     "status" "UserStatus",
ADD COLUMN     "statusUntil" TIMESTAMP(3),
ADD COLUMN     "customStatusEmoji" TEXT,
ADD COLUMN     "customStatusText" TEXT,
ADD COLUMN     "customStatusUntil" TIMESTAMP(3);
