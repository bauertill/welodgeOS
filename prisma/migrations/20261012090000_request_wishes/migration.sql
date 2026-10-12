-- What the client wants with the rooms (doc §4.11): people per unit, breakfast,
-- cleaning and parking.
-- CreateEnum
CREATE TYPE "CleaningWanted" AS ENUM ('DAILY', 'EVERY_FEW_DAYS', 'WEEKLY', 'NONE');

-- AlterTable
ALTER TABLE "SalesRequest" ADD COLUMN     "breakfast" BOOLEAN,
ADD COLUMN     "cleaning" "CleaningWanted",
ADD COLUMN     "parking" BOOLEAN,
ADD COLUMN     "parkingSpaces" INTEGER;

-- AlterTable
ALTER TABLE "SalesRequestLine" ADD COLUMN     "people" INTEGER;
