-- AlterTable
ALTER TABLE "RateCard" ADD COLUMN     "cancellationTerms" TEXT,
ADD COLUMN     "clientCanAnswer" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "paymentTerms" TEXT,
ADD COLUMN     "termsPerProperty" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "RateCardLine" ADD COLUMN     "likedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "RateCardProperty" ADD COLUMN     "cancellationTerms" TEXT,
ADD COLUMN     "paymentTerms" TEXT,
ADD COLUMN     "rateIncludes" TEXT;

