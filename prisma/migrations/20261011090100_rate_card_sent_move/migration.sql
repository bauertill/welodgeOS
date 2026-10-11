-- Requests still at Initial interest whose client already has a rate card's
-- link move to Rate card sent, as they would have had the stage existed (doc §4.11).
UPDATE "SalesRequest" r
SET "stage" = 'RATE_CARD_SENT'
WHERE r."stage" = 'INITIAL_INTEREST'
  AND EXISTS (SELECT 1 FROM "RateCard" c WHERE c."salesRequestId" = r."id" AND c."shareToken" IS NOT NULL);
