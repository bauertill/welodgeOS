-- A contractor now belongs to one event (doc §3.11, the owner 2026-11-19:
-- "they form part of an event and don't cross from event to event").
-- Any contractor made in the meantime takes the first event it was put on,
-- or else the event of its first contract.

DROP INDEX "Contractor_name_key";

ALTER TABLE "Contractor" ADD COLUMN "eventId" TEXT;

UPDATE "Contractor" c SET "eventId" = (
  SELECT ce."eventId" FROM "ContractorEvent" ce WHERE ce."contractorId" = c."id" ORDER BY ce."createdAt" LIMIT 1
);
UPDATE "Contractor" c SET "eventId" = (
  SELECT k."eventId" FROM "Contract" k WHERE k."contractorId" = c."id" ORDER BY k."createdAt" LIMIT 1
) WHERE c."eventId" IS NULL;

ALTER TABLE "Contractor" ALTER COLUMN "eventId" SET NOT NULL;

DROP TABLE "ContractorEvent";

CREATE INDEX "Contractor_eventId_idx" ON "Contractor"("eventId");
CREATE UNIQUE INDEX "Contractor_eventId_name_key" ON "Contractor"("eventId", "name");
ALTER TABLE "Contractor" ADD CONSTRAINT "Contractor_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;
