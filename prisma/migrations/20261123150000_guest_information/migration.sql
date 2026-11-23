-- AlterTable
ALTER TABLE "Event" ADD COLUMN     "guestContact" TEXT;

-- AlterTable
ALTER TABLE "Property" ADD COLUMN     "guestCheckIn" TEXT,
ADD COLUMN     "guestCityTax" TEXT,
ADD COLUMN     "guestEmergency" TEXT,
ADD COLUMN     "guestOther" TEXT,
ADD COLUMN     "guestParking" TEXT,
ADD COLUMN     "guestPayment" TEXT,
ADD COLUMN     "guestRules" TEXT,
ADD COLUMN     "guestWifi" TEXT;

-- AlterTable
ALTER TABLE "SalesRequest" ADD COLUMN     "stayLinkMadeAt" TIMESTAMP(3),
ADD COLUMN     "stayToken" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "SalesRequest_stayToken_key" ON "SalesRequest"("stayToken");

