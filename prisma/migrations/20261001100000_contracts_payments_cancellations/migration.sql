-- Contracts (doc §7.1): a signed contract with a supplier or a client, for an
-- event — its PDF link, its total, and its payment and cancellation terms —
-- and the room-nights bought and sold under it. Nothing existing changes; no
-- night belongs to a contract until someone says so.

-- CreateEnum
CREATE TYPE "ContractParty" AS ENUM ('SUPPLIER', 'CLIENT');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('TO_BE_PAID', 'INVOICE_REQUESTED', 'INVOICE_RECEIVED', 'INVOICE_ISSUED', 'PAID', 'REFUND');

-- CreateEnum
CREATE TYPE "CancellationKind" AS ENUM ('ATTRITION', 'RELEASE', 'CLIENT_CANCELLATION', 'OTHER');

-- AlterTable
ALTER TABLE "RoomNight" ADD COLUMN     "acquisitionContractId" TEXT,
ADD COLUMN     "salesContractId" TEXT;

-- CreateTable
CREATE TABLE "Contract" (
    "id" TEXT NOT NULL,
    "party" "ContractParty" NOT NULL,
    "name" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "propertyId" TEXT,
    "clientId" TEXT,
    "salesRequestId" TEXT,
    "documentUrl" TEXT,
    "signedOn" DATE,
    "totalCents" INTEGER,
    "currency" TEXT,
    "notes" TEXT,
    "noCancellationTerms" BOOLEAN NOT NULL DEFAULT false,
    "ownerId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Contract_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContractPayment" (
    "id" TEXT NOT NULL,
    "contractId" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "dueOn" DATE NOT NULL,
    "percentBasisPoints" INTEGER,
    "amountCents" INTEGER,
    "status" "PaymentStatus" NOT NULL DEFAULT 'TO_BE_PAID',
    "paidOn" DATE,
    "invoiceUrl" TEXT,
    "proofUrl" TEXT,
    "beneficiary" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ContractPayment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContractCancellation" (
    "id" TEXT NOT NULL,
    "contractId" TEXT NOT NULL,
    "kind" "CancellationKind" NOT NULL,
    "cutoffOn" DATE NOT NULL,
    "percentBasisPoints" INTEGER,
    "appliesTo" TEXT,
    "roomType" TEXT,
    "feeBasisPoints" INTEGER,
    "remarks" TEXT,
    "handledOn" DATE,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ContractCancellation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Contract_eventId_idx" ON "Contract"("eventId");

-- CreateIndex
CREATE INDEX "Contract_propertyId_idx" ON "Contract"("propertyId");

-- CreateIndex
CREATE INDEX "Contract_clientId_idx" ON "Contract"("clientId");

-- CreateIndex
CREATE INDEX "ContractPayment_contractId_idx" ON "ContractPayment"("contractId");

-- CreateIndex
CREATE INDEX "ContractPayment_dueOn_idx" ON "ContractPayment"("dueOn");

-- CreateIndex
CREATE INDEX "ContractCancellation_contractId_idx" ON "ContractCancellation"("contractId");

-- CreateIndex
CREATE INDEX "ContractCancellation_cutoffOn_idx" ON "ContractCancellation"("cutoffOn");

-- AddForeignKey
ALTER TABLE "Contract" ADD CONSTRAINT "Contract_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Contract" ADD CONSTRAINT "Contract_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Contract" ADD CONSTRAINT "Contract_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Contract" ADD CONSTRAINT "Contract_salesRequestId_fkey" FOREIGN KEY ("salesRequestId") REFERENCES "SalesRequest"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Contract" ADD CONSTRAINT "Contract_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContractPayment" ADD CONSTRAINT "ContractPayment_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "Contract"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContractCancellation" ADD CONSTRAINT "ContractCancellation_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "Contract"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RoomNight" ADD CONSTRAINT "RoomNight_acquisitionContractId_fkey" FOREIGN KEY ("acquisitionContractId") REFERENCES "Contract"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RoomNight" ADD CONSTRAINT "RoomNight_salesContractId_fkey" FOREIGN KEY ("salesContractId") REFERENCES "Contract"("id") ON DELETE SET NULL ON UPDATE CASCADE;

