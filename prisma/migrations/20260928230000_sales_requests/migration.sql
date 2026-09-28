-- Sales requests (doc §4.11): a client's interest in accommodation, from the
-- first enquiry to signed, released, lost or never answered, with who to chase
-- and when, and the contracting details the lawyers need. Nothing existing
-- changes; the list starts empty.

-- CreateEnum
CREATE TYPE "SalesRequestStage" AS ENUM ('INITIAL_INTEREST', 'PROPOSAL_SENT', 'BLOCKED', 'SIGNED', 'RELEASED', 'NO_REPLY', 'LOST');

-- CreateTable
CREATE TABLE "SalesRequest" (
    "id" TEXT NOT NULL,
    "stage" "SalesRequestStage" NOT NULL DEFAULT 'INITIAL_INTEREST',
    "clientId" TEXT NOT NULL,
    "contactId" TEXT,
    "eventId" TEXT,
    "ownerId" TEXT,
    "description" TEXT,
    "location" TEXT,
    "rooms" TEXT,
    "period" TEXT,
    "budget" TEXT,
    "prePost" TEXT,
    "rateIncludes" TEXT,
    "extraServices" TEXT,
    "followUpOn" DATE,
    "nextStep" TEXT,
    "proposalSentOn" DATE,
    "blockedUntil" DATE,
    "valueCents" INTEGER,
    "valueCurrency" TEXT,
    "closedOn" DATE,
    "tradeName" TEXT,
    "companyAddress" TEXT,
    "vatNumber" TEXT,
    "registrationNumber" TEXT,
    "signatory1Name" TEXT,
    "signatory1Designation" TEXT,
    "signatory2Name" TEXT,
    "signatory2Designation" TEXT,
    "contractContacts" TEXT,
    "propertyNameAndAddress" TEXT,
    "paymentSchedule" TEXT,
    "cancellationPolicy" TEXT,
    "otherServices" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SalesRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SalesRequest_clientId_idx" ON "SalesRequest"("clientId");

-- CreateIndex
CREATE INDEX "SalesRequest_eventId_idx" ON "SalesRequest"("eventId");

-- CreateIndex
CREATE INDEX "SalesRequest_stage_idx" ON "SalesRequest"("stage");

-- CreateIndex
CREATE INDEX "SalesRequest_followUpOn_idx" ON "SalesRequest"("followUpOn");

-- AddForeignKey
ALTER TABLE "SalesRequest" ADD CONSTRAINT "SalesRequest_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesRequest" ADD CONSTRAINT "SalesRequest_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "ClientContact"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesRequest" ADD CONSTRAINT "SalesRequest_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesRequest" ADD CONSTRAINT "SalesRequest_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

