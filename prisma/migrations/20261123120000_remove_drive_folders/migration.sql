-- Drive folders removed (the owner, 2026-11-23: "not needed anymore").
-- Never switched on, so these columns were empty on live.
ALTER TABLE "Event" DROP COLUMN "driveFolderId";
ALTER TABLE "ScoutingEntry" DROP COLUMN "driveFolderId";
