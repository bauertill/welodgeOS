-- A quotation's payments and cancellation cut-offs, line by line (doc §3.10).
-- CreateTable
CREATE TABLE "QuotationPayment" (
    "id" TEXT NOT NULL,
    "quotationId" TEXT NOT NULL,
    "onSignature" BOOLEAN NOT NULL DEFAULT false,
    "dueOn" DATE,
    "percentBasisPoints" INTEGER NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "QuotationPayment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QuotationCancellation" (
    "id" TEXT NOT NULL,
    "quotationId" TEXT NOT NULL,
    "kind" "CancellationKind" NOT NULL,
    "cutoffOn" DATE NOT NULL,
    "percentBasisPoints" INTEGER,
    "feeBasisPoints" INTEGER,
    "remarks" TEXT,
    "position" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "QuotationCancellation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "QuotationPayment_quotationId_idx" ON "QuotationPayment"("quotationId");

-- CreateIndex
CREATE INDEX "QuotationCancellation_quotationId_idx" ON "QuotationCancellation"("quotationId");

-- AddForeignKey
ALTER TABLE "QuotationPayment" ADD CONSTRAINT "QuotationPayment_quotationId_fkey" FOREIGN KEY ("quotationId") REFERENCES "Quotation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuotationCancellation" ADD CONSTRAINT "QuotationCancellation_quotationId_fkey" FOREIGN KEY ("quotationId") REFERENCES "Quotation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

