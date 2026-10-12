-- What the client wants with the rooms (doc §4.11): people per unit, breakfast,
-- cleaning, parking and what else matters to them, from the amenity list.
-- CreateEnum
CREATE TYPE "CleaningWanted" AS ENUM ('DAILY', 'EVERY_FEW_DAYS', 'WEEKLY', 'NONE');

-- AlterTable
ALTER TABLE "SalesRequest" ADD COLUMN     "breakfast" BOOLEAN,
ADD COLUMN     "cleaning" "CleaningWanted",
ADD COLUMN     "parking" BOOLEAN,
ADD COLUMN     "parkingSpaces" INTEGER;

-- AlterTable
ALTER TABLE "SalesRequestLine" ADD COLUMN     "people" INTEGER;

-- CreateTable
CREATE TABLE "_SalesRequestMustHaves" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,

    CONSTRAINT "_SalesRequestMustHaves_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateIndex
CREATE INDEX "_SalesRequestMustHaves_B_index" ON "_SalesRequestMustHaves"("B");

-- AddForeignKey
ALTER TABLE "_SalesRequestMustHaves" ADD CONSTRAINT "_SalesRequestMustHaves_A_fkey" FOREIGN KEY ("A") REFERENCES "Amenity"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_SalesRequestMustHaves" ADD CONSTRAINT "_SalesRequestMustHaves_B_fkey" FOREIGN KEY ("B") REFERENCES "SalesRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

