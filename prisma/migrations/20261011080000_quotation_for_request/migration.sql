-- A quotation can be for one client's request (doc §3.10, §4.11).
-- AlterTable
ALTER TABLE "Quotation" ADD COLUMN     "salesRequestId" TEXT;

-- CreateIndex
CREATE INDEX "Quotation_salesRequestId_idx" ON "Quotation"("salesRequestId");

-- AddForeignKey
ALTER TABLE "Quotation" ADD CONSTRAINT "Quotation_salesRequestId_fkey" FOREIGN KEY ("salesRequestId") REFERENCES "SalesRequest"("id") ON DELETE SET NULL ON UPDATE CASCADE;

