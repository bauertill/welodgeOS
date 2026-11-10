-- AlterTable
ALTER TABLE "Update" ADD COLUMN     "salesRequestId" TEXT;

-- CreateIndex
CREATE INDEX "Update_salesRequestId_idx" ON "Update"("salesRequestId");

-- AddForeignKey
ALTER TABLE "Update" ADD CONSTRAINT "Update_salesRequestId_fkey" FOREIGN KEY ("salesRequestId") REFERENCES "SalesRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

