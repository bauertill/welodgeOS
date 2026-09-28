-- The accommodation overview (doc §3.9), step 3: each room category's rates
-- and taxes agreed per event (on its contract row for that event), and its own
-- size and notes. Purely additive: every new field starts empty.

-- AlterTable
ALTER TABLE "CategoryContract" ADD COLUMN     "applicablePeriod" TEXT,
ADD COLUMN     "otherTaxes" TEXT,
ADD COLUMN     "rateCurrency" TEXT,
ADD COLUMN     "rateIncludes" TEXT,
ADD COLUMN     "ratePerNightCents" INTEGER,
ADD COLUMN     "totBasisPoints" INTEGER;

-- AlterTable
ALTER TABLE "RoomCategory" ADD COLUMN     "notes" TEXT,
ADD COLUMN     "size" TEXT;
