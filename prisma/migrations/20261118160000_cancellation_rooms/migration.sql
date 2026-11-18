-- AlterTable
ALTER TABLE "OfferCancellation" ADD COLUMN     "roomType" TEXT,
ADD COLUMN     "rooms" INTEGER,
ALTER COLUMN "cutoffOn" DROP NOT NULL;

-- AlterTable
ALTER TABLE "QuotationCancellation" ADD COLUMN     "roomType" TEXT,
ADD COLUMN     "rooms" INTEGER,
ALTER COLUMN "cutoffOn" DROP NOT NULL;

