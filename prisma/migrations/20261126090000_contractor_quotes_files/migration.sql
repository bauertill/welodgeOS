-- CreateTable
CREATE TABLE "ContractorQuote" (
    "id" TEXT NOT NULL,
    "contractorId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "amountCents" INTEGER,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "receivedOn" DATE,
    "validUntil" DATE,
    "status" "QuotationStatus" NOT NULL DEFAULT 'RECEIVED',
    "documentUrl" TEXT,
    "notes" TEXT,
    "contractId" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ContractorQuote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContractorFile" (
    "id" TEXT NOT NULL,
    "contractorId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "addedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ContractorFile_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ContractorQuote_contractId_key" ON "ContractorQuote"("contractId");

-- CreateIndex
CREATE INDEX "ContractorQuote_contractorId_idx" ON "ContractorQuote"("contractorId");

-- CreateIndex
CREATE INDEX "ContractorFile_contractorId_createdAt_idx" ON "ContractorFile"("contractorId", "createdAt");

-- AddForeignKey
ALTER TABLE "ContractorQuote" ADD CONSTRAINT "ContractorQuote_contractorId_fkey" FOREIGN KEY ("contractorId") REFERENCES "Contractor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContractorQuote" ADD CONSTRAINT "ContractorQuote_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "Contract"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContractorQuote" ADD CONSTRAINT "ContractorQuote_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContractorFile" ADD CONSTRAINT "ContractorFile_contractorId_fkey" FOREIGN KEY ("contractorId") REFERENCES "Contractor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContractorFile" ADD CONSTRAINT "ContractorFile_addedById_fkey" FOREIGN KEY ("addedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

