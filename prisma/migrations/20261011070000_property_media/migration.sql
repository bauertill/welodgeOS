-- Media for a property (doc §3.10): its Dropbox photos folder, the photos picked
-- for clients, and which of them each rate card shows (doc §4.11).

-- AlterTable
ALTER TABLE "Property" ADD COLUMN     "photosUrl" TEXT;

-- CreateTable
CREATE TABLE "PropertyPhoto" (
    "id" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "name" TEXT,
    "caption" TEXT,
    "categoryId" TEXT,
    "position" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "addedById" TEXT,

    CONSTRAINT "PropertyPhoto_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RateCardPhoto" (
    "rateCardPropertyId" TEXT NOT NULL,
    "photoId" TEXT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "RateCardPhoto_pkey" PRIMARY KEY ("rateCardPropertyId","photoId")
);

-- CreateIndex
CREATE INDEX "PropertyPhoto_propertyId_position_idx" ON "PropertyPhoto"("propertyId", "position");

-- CreateIndex
CREATE INDEX "RateCardPhoto_photoId_idx" ON "RateCardPhoto"("photoId");

-- AddForeignKey
ALTER TABLE "PropertyPhoto" ADD CONSTRAINT "PropertyPhoto_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PropertyPhoto" ADD CONSTRAINT "PropertyPhoto_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "RoomCategory"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PropertyPhoto" ADD CONSTRAINT "PropertyPhoto_addedById_fkey" FOREIGN KEY ("addedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RateCardPhoto" ADD CONSTRAINT "RateCardPhoto_rateCardPropertyId_fkey" FOREIGN KEY ("rateCardPropertyId") REFERENCES "RateCardProperty"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RateCardPhoto" ADD CONSTRAINT "RateCardPhoto_photoId_fkey" FOREIGN KEY ("photoId") REFERENCES "PropertyPhoto"("id") ON DELETE CASCADE ON UPDATE CASCADE;

