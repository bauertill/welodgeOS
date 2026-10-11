-- CreateTable
CREATE TABLE "RateCard" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "salesRequestId" TEXT NOT NULL,
    "currency" TEXT NOT NULL,
    "markupBasisPoints" INTEGER,
    "intro" TEXT,
    "shareToken" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RateCard_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RateCardProperty" (
    "id" TEXT NOT NULL,
    "rateCardId" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "description" TEXT,

    CONSTRAINT "RateCardProperty_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RateCardLine" (
    "id" TEXT NOT NULL,
    "rateCardPropertyId" TEXT NOT NULL,
    "categoryId" TEXT,
    "name" TEXT NOT NULL,
    "sleeps" INTEGER,
    "buyingCents" INTEGER,
    "sellingCents" INTEGER,
    "position" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "RateCardLine_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "RateCard_shareToken_key" ON "RateCard"("shareToken");

-- CreateIndex
CREATE INDEX "RateCard_salesRequestId_idx" ON "RateCard"("salesRequestId");

-- CreateIndex
CREATE INDEX "RateCardProperty_rateCardId_idx" ON "RateCardProperty"("rateCardId");

-- CreateIndex
CREATE INDEX "RateCardLine_rateCardPropertyId_idx" ON "RateCardLine"("rateCardPropertyId");

-- AddForeignKey
ALTER TABLE "RateCard" ADD CONSTRAINT "RateCard_salesRequestId_fkey" FOREIGN KEY ("salesRequestId") REFERENCES "SalesRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RateCard" ADD CONSTRAINT "RateCard_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RateCardProperty" ADD CONSTRAINT "RateCardProperty_rateCardId_fkey" FOREIGN KEY ("rateCardId") REFERENCES "RateCard"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RateCardProperty" ADD CONSTRAINT "RateCardProperty_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RateCardLine" ADD CONSTRAINT "RateCardLine_rateCardPropertyId_fkey" FOREIGN KEY ("rateCardPropertyId") REFERENCES "RateCardProperty"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RateCardLine" ADD CONSTRAINT "RateCardLine_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "RoomCategory"("id") ON DELETE SET NULL ON UPDATE CASCADE;

