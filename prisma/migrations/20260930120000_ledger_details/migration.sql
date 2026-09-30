-- Each inventory ledger entry can say what it did to the nights' details —
-- prices, references, notes, dates — field by field (doc §4.7). Entries already
-- written say nothing more than before.

-- AlterTable
ALTER TABLE "LedgerEntry" ADD COLUMN     "details" TEXT;

