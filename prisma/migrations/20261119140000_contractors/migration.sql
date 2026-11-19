-- CreateEnum
CREATE TYPE "ContractorKind" AS ENUM ('FURNITURE', 'CLEANING', 'LINEN', 'MAINTENANCE', 'TRANSPORT', 'SECURITY', 'CATERING', 'OTHER');

-- AlterTable
ALTER TABLE "Contract" ADD COLUMN     "contractorId" TEXT;

-- AlterTable
ALTER TABLE "Task" ADD COLUMN     "contractorId" TEXT;

-- AlterTable
ALTER TABLE "Update" ADD COLUMN     "contractorId" TEXT;

-- CreateTable
CREATE TABLE "Contractor" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" "ContractorKind" NOT NULL DEFAULT 'OTHER',
    "service" TEXT,
    "website" TEXT,
    "email" TEXT,
    "phone" TEXT,
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

    CONSTRAINT "Contractor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContractorContact" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "role" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "contractorId" TEXT NOT NULL,

    CONSTRAINT "ContractorContact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContractorEvent" (
    "contractorId" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ContractorEvent_pkey" PRIMARY KEY ("contractorId","eventId")
);

-- CreateTable
CREATE TABLE "ContractorProperty" (
    "contractorId" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "what" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ContractorProperty_pkey" PRIMARY KEY ("contractorId","propertyId")
);

-- CreateIndex
CREATE UNIQUE INDEX "Contractor_name_key" ON "Contractor"("name");

-- CreateIndex
CREATE INDEX "ContractorContact_contractorId_idx" ON "ContractorContact"("contractorId");

-- CreateIndex
CREATE INDEX "ContractorEvent_eventId_idx" ON "ContractorEvent"("eventId");

-- CreateIndex
CREATE INDEX "ContractorProperty_propertyId_idx" ON "ContractorProperty"("propertyId");

-- AddForeignKey
ALTER TABLE "ContractorContact" ADD CONSTRAINT "ContractorContact_contractorId_fkey" FOREIGN KEY ("contractorId") REFERENCES "Contractor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContractorEvent" ADD CONSTRAINT "ContractorEvent_contractorId_fkey" FOREIGN KEY ("contractorId") REFERENCES "Contractor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContractorEvent" ADD CONSTRAINT "ContractorEvent_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContractorProperty" ADD CONSTRAINT "ContractorProperty_contractorId_fkey" FOREIGN KEY ("contractorId") REFERENCES "Contractor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContractorProperty" ADD CONSTRAINT "ContractorProperty_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Contract" ADD CONSTRAINT "Contract_contractorId_fkey" FOREIGN KEY ("contractorId") REFERENCES "Contractor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Update" ADD CONSTRAINT "Update_contractorId_fkey" FOREIGN KEY ("contractorId") REFERENCES "Contractor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_contractorId_fkey" FOREIGN KEY ("contractorId") REFERENCES "Contractor"("id") ON DELETE SET NULL ON UPDATE CASCADE;

