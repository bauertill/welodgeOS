-- The accommodation overview (doc §3.9), step 2: the rest of what the team
-- records about a property and its contracting details; providers (the chain
-- or group, one to many properties) with their own contacts and contracting
-- details; and the terms agreed per event on a property's entry. Purely
-- additive: every new field starts empty.

-- AlterTable
ALTER TABLE "Property" ADD COLUMN     "area" TEXT,
ADD COLUMN     "bic" TEXT,
ADD COLUMN     "breakfast" TEXT,
ADD COLUMN     "checkInTime" TEXT,
ADD COLUMN     "checkOutTime" TEXT,
ADD COLUMN     "cleaning" TEXT,
ADD COLUMN     "contractEmail" TEXT,
ADD COLUMN     "generalEmail" TEXT,
ADD COLUMN     "gym" TEXT,
ADD COLUMN     "iban" TEXT,
ADD COLUMN     "laundry" TEXT,
ADD COLUMN     "providerId" TEXT,
ADD COLUMN     "publicTransport" TEXT,
ADD COLUMN     "registrationNumber" TEXT,
ADD COLUMN     "signatoryName" TEXT,
ADD COLUMN     "signatoryTitle" TEXT,
ADD COLUMN     "tradeName" TEXT,
ADD COLUMN     "vatNumber" TEXT,
ADD COLUMN     "videoUrl" TEXT,
ADD COLUMN     "yearBuilt" INTEGER;

-- AlterTable
ALTER TABLE "ScoutingEntry" ADD COLUMN     "accountManagerId" TEXT,
ADD COLUMN     "applicablePeriod" TEXT,
ADD COLUMN     "blockExpiry" DATE,
ADD COLUMN     "cancellationTerms" TEXT,
ADD COLUMN     "deposit" TEXT,
ADD COLUMN     "minimumStayNights" INTEGER,
ADD COLUMN     "paymentTerms" TEXT,
ADD COLUMN     "ratesInclude" TEXT,
ADD COLUMN     "roomingListDeadline" DATE;

-- CreateTable
CREATE TABLE "Provider" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "website" TEXT,
    "notes" TEXT,
    "tradeName" TEXT,
    "vatNumber" TEXT,
    "registrationNumber" TEXT,
    "iban" TEXT,
    "bic" TEXT,
    "signatoryName" TEXT,
    "signatoryTitle" TEXT,
    "contractEmail" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Provider_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProviderContact" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "role" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "providerId" TEXT NOT NULL,

    CONSTRAINT "ProviderContact_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Provider_name_key" ON "Provider"("name");

-- CreateIndex
CREATE INDEX "ProviderContact_providerId_idx" ON "ProviderContact"("providerId");

-- AddForeignKey
ALTER TABLE "Property" ADD CONSTRAINT "Property_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "Provider"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProviderContact" ADD CONSTRAINT "ProviderContact_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "Provider"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScoutingEntry" ADD CONSTRAINT "ScoutingEntry_accountManagerId_fkey" FOREIGN KEY ("accountManagerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
