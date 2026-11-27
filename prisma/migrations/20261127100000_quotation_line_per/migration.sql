-- CreateEnum
CREATE TYPE "ChargedPer" AS ENUM ('NIGHT', 'DAY');

-- AlterTable
ALTER TABLE "QuotationLine" ADD COLUMN     "per" "ChargedPer" NOT NULL DEFAULT 'NIGHT';
