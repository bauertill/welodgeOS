-- What a room category's rate includes becomes a list to tick (doc §3.9) —
-- breakfast, Wi-Fi, taxes, parking, cleaning — with anything else said in
-- words. Cleaning, when included, says how often: daily, weekly, or in words. The wording already
-- typed is read into the list: "BF, WI-FI, Taxes" ticks breakfast, Wi-Fi and
-- taxes; whatever is not recognised ("TOT & TMD") is kept, word for word, as
-- the "other" text, so nothing is lost.

-- CreateEnum
CREATE TYPE "RateInclusion" AS ENUM ('BREAKFAST', 'WIFI', 'TAXES', 'PARKING');

-- CreateEnum
CREATE TYPE "Cleaning" AS ENUM ('DAILY', 'WEEKLY', 'OTHER');

-- AlterTable
ALTER TABLE "CategoryContract"
  ADD COLUMN "rateIncludesList" "RateInclusion"[] NOT NULL DEFAULT ARRAY[]::"RateInclusion"[],
  ADD COLUMN "rateIncludesOther" TEXT,
  ADD COLUMN "cleaning" "Cleaning",
  ADD COLUMN "cleaningOther" TEXT;

-- Move the typed wording into the list, item by item.
WITH tokens AS (
  SELECT c."id", btrim(s.token) AS token, s.ord
  FROM "CategoryContract" c,
       regexp_split_to_table(c."rateIncludes", '\s*[,;&+/]\s*|\s+and\s+') WITH ORDINALITY AS s(token, ord)
  WHERE c."rateIncludes" IS NOT NULL
),
mapped AS (
  SELECT "id", ord, token,
    CASE regexp_replace(lower(token), '[^a-z]', '', 'g')
      WHEN 'bf' THEN 'BREAKFAST'
      WHEN 'breakfast' THEN 'BREAKFAST'
      WHEN 'wifi' THEN 'WIFI'
      WHEN 'tax' THEN 'TAXES'
      WHEN 'taxes' THEN 'TAXES'
      WHEN 'parking' THEN 'PARKING'
    END AS inclusion
  FROM tokens
  WHERE token <> ''
)
UPDATE "CategoryContract" c SET
  "rateIncludesList" = COALESCE(
    (SELECT array_agg(DISTINCT m.inclusion::"RateInclusion") FROM mapped m WHERE m."id" = c."id" AND m.inclusion IS NOT NULL),
    ARRAY[]::"RateInclusion"[]),
  "rateIncludesOther" =
    (SELECT string_agg(m.token, ', ' ORDER BY m.ord) FROM mapped m WHERE m."id" = c."id" AND m.inclusion IS NULL)
WHERE c."rateIncludes" IS NOT NULL;

ALTER TABLE "CategoryContract" DROP COLUMN "rateIncludes";
ALTER TABLE "CategoryContract" RENAME COLUMN "rateIncludesList" TO "rateIncludes";
