-- Taxes on quotations and contracts: a fixed tax per room per night, the taxes on a
-- contract, and a payment that also takes all the taxes (doc §3.10, §7.1).
-- AlterTable
ALTER TABLE "Quotation" ADD COLUMN     "taxPerNightCents" INTEGER;

-- AlterTable
ALTER TABLE "QuotationPayment" ADD COLUMN     "plusTaxes" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "Contract" ADD COLUMN     "taxCents" INTEGER;

-- AlterTable
ALTER TABLE "ContractPayment" ADD COLUMN     "plusTaxes" BOOLEAN NOT NULL DEFAULT false;

