-- Quotations (doc §3.10): a hotel's offers for an event, kept apart from the
-- hotel's general details — several scenarios at once, each with periods and
-- room categories, rooms and rates, and the terms offered. An accepted one can
-- become the supplier contract. Nothing existing changes.

-- CreateEnum
CREATE TYPE "QuotationStatus" AS ENUM ('RECEIVED', 'ACCEPTED', 'DECLINED');

-- CreateTable
CREATE TABLE "Quotation" (
    "id" TEXT NOT NULL,
    "status" "QuotationStatus" NOT NULL DEFAULT 'RECEIVED',
    "name" TEXT NOT NULL,
    "scoutingEntryId" TEXT NOT NULL,
    "receivedOn" DATE,
    "validUntil" DATE,
    "persons" INTEGER,
    "currency" TEXT NOT NULL,
    "paymentTerms" TEXT,
    "cancellationTerms" TEXT,
    "ratesInclude" TEXT,
    "documentUrl" TEXT,
    "notes" TEXT,
    "contractId" TEXT,
    "addedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Quotation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QuotationLine" (
    "id" TEXT NOT NULL,
    "quotationId" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,
    "checkIn" DATE NOT NULL,
    "checkOut" DATE NOT NULL,
    "rooms" INTEGER NOT NULL,
    "rateCents" INTEGER NOT NULL,
    "occupancy" INTEGER,
    "position" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "QuotationLine_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Quotation_scoutingEntryId_idx" ON "Quotation"("scoutingEntryId");

-- CreateIndex
CREATE INDEX "QuotationLine_quotationId_idx" ON "QuotationLine"("quotationId");

-- AddForeignKey
ALTER TABLE "Quotation" ADD CONSTRAINT "Quotation_scoutingEntryId_fkey" FOREIGN KEY ("scoutingEntryId") REFERENCES "ScoutingEntry"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Quotation" ADD CONSTRAINT "Quotation_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "Contract"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Quotation" ADD CONSTRAINT "Quotation_addedById_fkey" FOREIGN KEY ("addedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuotationLine" ADD CONSTRAINT "QuotationLine_quotationId_fkey" FOREIGN KEY ("quotationId") REFERENCES "Quotation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuotationLine" ADD CONSTRAINT "QuotationLine_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "RoomCategory"("id") ON DELETE CASCADE ON UPDATE CASCADE;

