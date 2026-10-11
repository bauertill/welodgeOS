-- A rate card's room says how many units we can offer and the shortest stay (doc §4.11).
ALTER TABLE "RateCardLine" ADD COLUMN "available" INTEGER,
ADD COLUMN "minNights" INTEGER;
