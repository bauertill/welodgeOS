-- Which monday.com deal a sales request was imported from (doc §4.11, 2026-11-09),
-- so an import run twice adds nothing twice. Additive only.

-- AlterTable
ALTER TABLE "SalesRequest" ADD COLUMN     "mondayItemId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "SalesRequest_mondayItemId_key" ON "SalesRequest"("mondayItemId");
