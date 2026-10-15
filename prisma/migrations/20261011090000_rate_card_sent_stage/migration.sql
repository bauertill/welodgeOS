-- A sales request stage between Initial interest and Proposal sent: the client
-- has a rate card's link (doc §4.11). Added on its own, as Postgres needs a new
-- enum value committed before it is used.
ALTER TYPE "SalesRequestStage" ADD VALUE 'RATE_CARD_SENT' BEFORE 'PROPOSAL_SENT';
