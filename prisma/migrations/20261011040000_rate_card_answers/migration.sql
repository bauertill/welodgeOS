-- AlterEnum
ALTER TYPE "NotificationKind" ADD VALUE 'RATE_CARD_ANSWERED';

-- CreateTable
CREATE TABLE "RateCardResponse" (
    "id" TEXT NOT NULL,
    "rateCardId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "name" TEXT,
    "email" TEXT,
    "note" TEXT,
    "datesChanged" BOOLEAN NOT NULL DEFAULT false,
    "newCheckIn" DATE,
    "newCheckOut" DATE,
    "datesNote" TEXT,

    CONSTRAINT "RateCardResponse_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RateCardResponseItem" (
    "id" TEXT NOT NULL,
    "responseId" TEXT NOT NULL,
    "lineId" TEXT,
    "propertyName" TEXT NOT NULL,
    "roomName" TEXT NOT NULL,
    "sellingCents" INTEGER,
    "rooms" INTEGER NOT NULL,
    "checkIn" DATE,
    "checkOut" DATE,
    "note" TEXT,

    CONSTRAINT "RateCardResponseItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RateCardResponse_rateCardId_createdAt_idx" ON "RateCardResponse"("rateCardId", "createdAt");

-- CreateIndex
CREATE INDEX "RateCardResponseItem_responseId_idx" ON "RateCardResponseItem"("responseId");

-- AddForeignKey
ALTER TABLE "RateCardResponse" ADD CONSTRAINT "RateCardResponse_rateCardId_fkey" FOREIGN KEY ("rateCardId") REFERENCES "RateCard"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RateCardResponseItem" ADD CONSTRAINT "RateCardResponseItem_responseId_fkey" FOREIGN KEY ("responseId") REFERENCES "RateCardResponse"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RateCardResponseItem" ADD CONSTRAINT "RateCardResponseItem_lineId_fkey" FOREIGN KEY ("lineId") REFERENCES "RateCardLine"("id") ON DELETE SET NULL ON UPDATE CASCADE;

