-- An event's currency (doc §2.3), and a quotation's taxes as a list of taxes
-- and fees (doc §3.10) in place of one TOT % and one fixed tax per night.

-- CreateEnum
CREATE TYPE "TaxKind" AS ENUM ('OCCUPANCY', 'CITY', 'VAT', 'SALES', 'ISS', 'SERVICE_CHARGE', 'TOURISM', 'TOURISM_DISTRICT', 'RESORT_FEE', 'OTHER');

-- AlterTable
ALTER TABLE "Event" ADD COLUMN     "currency" TEXT NOT NULL DEFAULT 'USD';

-- CreateTable
CREATE TABLE "QuotationTax" (
    "id" TEXT NOT NULL,
    "quotationId" TEXT NOT NULL,
    "kind" "TaxKind" NOT NULL,
    "label" TEXT,
    "basisPoints" INTEGER,
    "amountCents" INTEGER,
    "position" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "QuotationTax_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "QuotationTax_quotationId_idx" ON "QuotationTax"("quotationId");

-- AddForeignKey
ALTER TABLE "QuotationTax" ADD CONSTRAINT "QuotationTax_quotationId_fkey" FOREIGN KEY ("quotationId") REFERENCES "Quotation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Move the existing taxes across: the TOT becomes an occupancy tax line, the
-- fixed tax per room per night a line of its own, in that order.
INSERT INTO "QuotationTax" ("id", "quotationId", "kind", "basisPoints", "position")
SELECT 'qtax_' || md5("id" || '-tot'), "id", 'OCCUPANCY', "totBasisPoints", 0
FROM "Quotation" WHERE "totBasisPoints" IS NOT NULL;

INSERT INTO "QuotationTax" ("id", "quotationId", "kind", "label", "amountCents", "position")
SELECT 'qtax_' || md5("id" || '-fixed'), "id", 'OTHER', 'Tax per room per night', "taxPerNightCents", 1
FROM "Quotation" WHERE "taxPerNightCents" IS NOT NULL;

-- AlterTable
ALTER TABLE "Quotation" DROP COLUMN "taxPerNightCents",
DROP COLUMN "totBasisPoints";
