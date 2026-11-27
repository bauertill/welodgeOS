-- AlterTable
ALTER TABLE "Offer" ADD COLUMN     "sharedAt" TIMESTAMP(3),
ADD COLUMN     "shareToken" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Offer_shareToken_key" ON "Offer"("shareToken");
