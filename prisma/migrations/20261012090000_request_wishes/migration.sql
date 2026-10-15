-- The client's preferences (doc §4.11): people per unit, breakfast and parking.
-- AlterTable
ALTER TABLE "SalesRequest" ADD COLUMN     "breakfast" BOOLEAN,
ADD COLUMN     "parking" BOOLEAN,
ADD COLUMN     "parkingSpaces" INTEGER;

-- AlterTable
ALTER TABLE "SalesRequestLine" ADD COLUMN     "people" INTEGER;
