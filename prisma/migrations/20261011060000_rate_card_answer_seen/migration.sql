-- A client's answer is new until someone in the team opens the card (doc §4.11).
ALTER TABLE "RateCardResponse" ADD COLUMN "seenAt" TIMESTAMP(3);
