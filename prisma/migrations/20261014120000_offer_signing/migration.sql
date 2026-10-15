-- CreateEnum
CREATE TYPE "AgreementParty" AS ENUM ('HOTEL', 'WE_LODGE');

-- AlterEnum
ALTER TYPE "NotificationKind" ADD VALUE 'OFFER_SIGNED';

-- AlterTable
ALTER TABLE "Offer" ADD COLUMN     "closedAt" TIMESTAMP(3),
ADD COLUMN     "closedById" TEXT,
ADD COLUMN     "contractId" TEXT;

-- AlterTable
ALTER TABLE "Quotation" ADD COLUMN     "agreementOn" "AgreementParty";

-- CreateIndex
CREATE UNIQUE INDEX "Offer_contractId_key" ON "Offer"("contractId");

-- AddForeignKey
ALTER TABLE "Offer" ADD CONSTRAINT "Offer_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "Contract"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Offer" ADD CONSTRAINT "Offer_closedById_fkey" FOREIGN KEY ("closedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

