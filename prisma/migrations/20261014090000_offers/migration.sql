-- CreateEnum
CREATE TYPE "OfferStatus" AS ENUM ('OPEN', 'SIGNED', 'TRUSTED', 'WITHDRAWN');

-- CreateTable
CREATE TABLE "Offer" (
    "id" TEXT NOT NULL,
    "salesRequestId" TEXT NOT NULL,
    "responseId" TEXT,
    "status" "OfferStatus" NOT NULL DEFAULT 'OPEN',
    "currency" TEXT NOT NULL,
    "validUntil" DATE NOT NULL,
    "inclusions" TEXT,
    "conditions" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Offer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OfferLine" (
    "id" TEXT NOT NULL,
    "offerId" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,
    "rooms" INTEGER NOT NULL,
    "checkIn" DATE NOT NULL,
    "checkOut" DATE NOT NULL,
    "rateCents" INTEGER NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "OfferLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OfferPayment" (
    "id" TEXT NOT NULL,
    "offerId" TEXT NOT NULL,
    "onSignature" BOOLEAN NOT NULL DEFAULT false,
    "dueOn" DATE,
    "percentBasisPoints" INTEGER NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "OfferPayment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OfferCancellation" (
    "id" TEXT NOT NULL,
    "offerId" TEXT NOT NULL,
    "kind" "CancellationKind" NOT NULL,
    "cutoffOn" DATE NOT NULL,
    "percentBasisPoints" INTEGER,
    "feeBasisPoints" INTEGER,
    "remarks" TEXT,
    "position" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "OfferCancellation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Offer_salesRequestId_idx" ON "Offer"("salesRequestId");

-- CreateIndex
CREATE INDEX "OfferLine_offerId_idx" ON "OfferLine"("offerId");

-- CreateIndex
CREATE INDEX "OfferPayment_offerId_idx" ON "OfferPayment"("offerId");

-- CreateIndex
CREATE INDEX "OfferCancellation_offerId_idx" ON "OfferCancellation"("offerId");

-- AddForeignKey
ALTER TABLE "Offer" ADD CONSTRAINT "Offer_salesRequestId_fkey" FOREIGN KEY ("salesRequestId") REFERENCES "SalesRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Offer" ADD CONSTRAINT "Offer_responseId_fkey" FOREIGN KEY ("responseId") REFERENCES "RateCardResponse"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Offer" ADD CONSTRAINT "Offer_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OfferLine" ADD CONSTRAINT "OfferLine_offerId_fkey" FOREIGN KEY ("offerId") REFERENCES "Offer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OfferLine" ADD CONSTRAINT "OfferLine_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "RoomCategory"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OfferPayment" ADD CONSTRAINT "OfferPayment_offerId_fkey" FOREIGN KEY ("offerId") REFERENCES "Offer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OfferCancellation" ADD CONSTRAINT "OfferCancellation_offerId_fkey" FOREIGN KEY ("offerId") REFERENCES "Offer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

