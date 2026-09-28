-- A sales request can have a private link for the client to fill in their own
-- contracting details (doc §4.11): its code, when it was made, and when the
-- client last sent the form. No request has one yet.

-- AlterTable
ALTER TABLE "SalesRequest" ADD COLUMN     "contractingLinkMadeAt" TIMESTAMP(3),
ADD COLUMN     "contractingSubmittedAt" TIMESTAMP(3),
ADD COLUMN     "contractingToken" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "SalesRequest_contractingToken_key" ON "SalesRequest"("contractingToken");

