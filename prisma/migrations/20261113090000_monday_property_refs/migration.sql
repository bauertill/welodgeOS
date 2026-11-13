-- AlterTable
ALTER TABLE "Property" ADD COLUMN     "mondayId" TEXT;

-- AlterTable
ALTER TABLE "Update" ADD COLUMN     "mondayId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Property_mondayId_key" ON "Property"("mondayId");

-- CreateIndex
CREATE UNIQUE INDEX "Update_mondayId_key" ON "Update"("mondayId");

