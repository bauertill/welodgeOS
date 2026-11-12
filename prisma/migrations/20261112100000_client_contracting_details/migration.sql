-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "ClientCategory" ADD VALUE 'TECHNICAL_SUPPLIER';
ALTER TYPE "ClientCategory" ADD VALUE 'MEDIA';

-- AlterTable
ALTER TABLE "Client" ADD COLUMN     "companyAddress" TEXT,
ADD COLUMN     "mondayRef" TEXT,
ADD COLUMN     "registrationNumber" TEXT,
ADD COLUMN     "signatory1Designation" TEXT,
ADD COLUMN     "signatory1Name" TEXT,
ADD COLUMN     "signatory2Designation" TEXT,
ADD COLUMN     "signatory2Name" TEXT,
ADD COLUMN     "tradeName" TEXT,
ADD COLUMN     "vatNumber" TEXT;

-- AlterTable
ALTER TABLE "ClientContact" ADD COLUMN     "mondayId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "ClientContact_mondayId_key" ON "ClientContact"("mondayId");

