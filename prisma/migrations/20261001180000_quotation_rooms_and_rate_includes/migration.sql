-- Quotations (doc §3.10): "Persons" becomes the number of rooms quoted for,
-- and "Rates include" becomes the same choice as a room category's rate —
-- breakfast, Wi-Fi, taxes, parking, cleaning and how often — with TOT and
-- other taxes. Whatever was written in words is kept as "anything else".

ALTER TABLE "Quotation" RENAME COLUMN "persons" TO "rooms";

ALTER TABLE "Quotation"
  ADD COLUMN "rateIncludes" "RateInclusion"[] DEFAULT ARRAY[]::"RateInclusion"[],
  ADD COLUMN "rateIncludesOther" TEXT,
  ADD COLUMN "cleaning" "Cleaning",
  ADD COLUMN "cleaningOther" TEXT,
  ADD COLUMN "totBasisPoints" INTEGER,
  ADD COLUMN "otherTaxes" TEXT;

UPDATE "Quotation" SET "rateIncludesOther" = "ratesInclude" WHERE "ratesInclude" IS NOT NULL;

ALTER TABLE "Quotation" DROP COLUMN "ratesInclude";
