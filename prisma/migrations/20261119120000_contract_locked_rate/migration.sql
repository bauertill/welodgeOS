-- AlterTable
ALTER TABLE "Contract" ADD COLUMN     "lockedRateCurrency" TEXT,
ADD COLUMN     "lockedRateFor" DATE,
ADD COLUMN     "lockedRateMicros" INTEGER,
ADD COLUMN     "lockedRateOn" DATE;

