-- Where an invoice goes, or how to be paid (doc §7.1, 2026-11-24).
ALTER TABLE "Contract" ADD COLUMN "paymentInstructions" TEXT;
