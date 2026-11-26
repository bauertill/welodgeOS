-- CreateTable
CREATE TABLE "ContractorQuoteLine" (
    "id" TEXT NOT NULL,
    "quoteId" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "unit" TEXT,
    "unitPriceCents" INTEGER NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "ContractorQuoteLine_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ContractorQuoteLine_quoteId_idx" ON "ContractorQuoteLine"("quoteId");

-- AddForeignKey
ALTER TABLE "ContractorQuoteLine" ADD CONSTRAINT "ContractorQuoteLine_quoteId_fkey" FOREIGN KEY ("quoteId") REFERENCES "ContractorQuote"("id") ON DELETE CASCADE ON UPDATE CASCADE;

