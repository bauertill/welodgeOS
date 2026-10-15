-- The sales request stages as the owner set them (doc §4.11, 2026-10-11):
-- Initial interest → Specify → Proposal sent → Negotiation → Contracted, or
-- Lost/Declined with its reason. Every request is carried over:
--   Initial interest   → Specify once its details are in, else Initial interest
--   Rate card sent     → Proposal sent
--   Proposal sent      → Proposal sent
--   Blocked            → Negotiation
--   Signed             → Contracted
--   Lost / No reply / Released → Lost/Declined, the old stage kept as the reason

CREATE TYPE "LostReason" AS ENUM ('DECLINED', 'NO_REPLY', 'RELEASED');
ALTER TABLE "SalesRequest" ADD COLUMN "lostReason" "LostReason";
UPDATE "SalesRequest"
SET "lostReason" = CASE "stage"::text
  WHEN 'LOST' THEN 'DECLINED'::"LostReason"
  WHEN 'NO_REPLY' THEN 'NO_REPLY'::"LostReason"
  WHEN 'RELEASED' THEN 'RELEASED'::"LostReason"
END
WHERE "stage"::text IN ('LOST', 'NO_REPLY', 'RELEASED');

ALTER TYPE "SalesRequestStage" RENAME TO "SalesRequestStage_old";
CREATE TYPE "SalesRequestStage" AS ENUM ('INITIAL_INTEREST', 'SPECIFY', 'PROPOSAL_SENT', 'NEGOTIATION', 'CONTRACTED', 'LOST');
ALTER TABLE "SalesRequest" ALTER COLUMN "stage" DROP DEFAULT;
ALTER TABLE "SalesRequest" ALTER COLUMN "stage" TYPE "SalesRequestStage" USING (
  CASE "stage"::text
    WHEN 'INITIAL_INTEREST' THEN CASE WHEN "detailedAt" IS NOT NULL THEN 'SPECIFY' ELSE 'INITIAL_INTEREST' END
    WHEN 'RATE_CARD_SENT' THEN 'PROPOSAL_SENT'
    WHEN 'PROPOSAL_SENT' THEN 'PROPOSAL_SENT'
    WHEN 'BLOCKED' THEN 'NEGOTIATION'
    WHEN 'SIGNED' THEN 'CONTRACTED'
    ELSE 'LOST'
  END
)::"SalesRequestStage";
ALTER TABLE "SalesRequest" ALTER COLUMN "stage" SET DEFAULT 'INITIAL_INTEREST';
DROP TYPE "SalesRequestStage_old";
