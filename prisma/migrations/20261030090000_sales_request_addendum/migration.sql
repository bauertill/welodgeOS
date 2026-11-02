-- A sales request can be an addendum to a contract the client already has,
-- and can say what it is waiting on while open (doc §4.11, 2026-10-30).
-- Additive only: every existing request is left as it was.

-- CreateEnum
CREATE TYPE "WaitingOn" AS ENUM ('CONTRACT_SENT', 'AWAITING_APPROVAL', 'PENDING');

-- AlterTable
ALTER TABLE "SalesRequest" ADD COLUMN     "amendsContractId" TEXT,
ADD COLUMN     "waitingOn" "WaitingOn",
ADD COLUMN     "waitingSince" DATE;

-- CreateIndex
CREATE INDEX "SalesRequest_amendsContractId_idx" ON "SalesRequest"("amendsContractId");

-- AddForeignKey
ALTER TABLE "SalesRequest" ADD CONSTRAINT "SalesRequest_amendsContractId_fkey" FOREIGN KEY ("amendsContractId") REFERENCES "Contract"("id") ON DELETE SET NULL ON UPDATE CASCADE;
