-- Undo in sequence (doc §4.7): undoing the latest change, then the one before
-- it, now works as the document always said it should. An entry records when
-- it was undone, and an undo's own entry is marked as such; neither stands in
-- the way of undoing something earlier.

-- AlterTable
ALTER TABLE "LedgerEntry" ADD COLUMN "undoneAt" TIMESTAMP(3),
ADD COLUMN "isUndo" BOOLEAN NOT NULL DEFAULT false;

-- Carry the history across: every undo so far wrote an entry "Undid: <the
-- original summary>" that could not itself be undone. Mark those as undos, and
-- mark the entry each one undid — the latest earlier entry in the same event
-- with that exact summary — with when it was undone.
UPDATE "LedgerEntry" SET "isUndo" = true
WHERE "undoable" = false AND "summary" LIKE 'Undid: %';

UPDATE "LedgerEntry" AS original
SET "undoneAt" = u."createdAt"
FROM "LedgerEntry" AS u
WHERE u."isUndo"
  AND u."eventId" = original."eventId"
  AND u."summary" = 'Undid: ' || original."summary"
  AND original."createdAt" < u."createdAt"
  AND original."undoneAt" IS NULL
  AND original."createdAt" = (
    SELECT max(o2."createdAt") FROM "LedgerEntry" o2
    WHERE o2."eventId" = u."eventId"
      AND o2."summary" = original."summary"
      AND o2."createdAt" < u."createdAt"
  );
