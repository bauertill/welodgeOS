-- A sales request's lines count units — hotel rooms or whole apartments — and
-- no longer how many people each (the owner's call, 2026-10-03, doc §4.11).

-- AlterTable
ALTER TABLE "SalesRequestLine" DROP COLUMN "occupancy";

