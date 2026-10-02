-- A room category's status starts blank (doc §3.5): NOT_STARTED, added in the
-- migration before this one, becomes the default.

ALTER TABLE "CategoryContract" ALTER COLUMN "status" SET DEFAULT 'NOT_STARTED';

-- Rows made only by saving a category's rates started as IN_NEGOTIATION
-- without anyone choosing it. A status someone did choose always left a
-- "Contract status: …" entry in the history (the dropdown already showed In
-- negotiation, so it could only be reached by a change), so a row in
-- IN_NEGOTIATION with no such entry goes back to blank.
UPDATE "CategoryContract" c
SET "status" = 'NOT_STARTED'
WHERE c."status" = 'IN_NEGOTIATION'
  AND NOT EXISTS (
    SELECT 1 FROM "AuditEntry" a
    WHERE a."entity" = 'CategoryContract' AND a."entityId" = c."id" AND a."summary" LIKE 'Contract status:%'
  );
