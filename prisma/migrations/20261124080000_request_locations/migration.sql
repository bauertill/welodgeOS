-- AlterTable
ALTER TABLE "SalesRequestLine" ADD COLUMN     "locationId" TEXT;

-- AlterTable
ALTER TABLE "SalesRequestPoint" ADD COLUMN     "locationId" TEXT;

-- AlterTable
ALTER TABLE "Task" ADD COLUMN     "salesLocationId" TEXT;

-- CreateTable
CREATE TABLE "SalesRequestLocation" (
    "id" TEXT NOT NULL,
    "salesRequestId" TEXT NOT NULL,
    "name" TEXT,
    "notes" TEXT,
    "position" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "SalesRequestLocation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "_LocationCloseTo" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,

    CONSTRAINT "_LocationCloseTo_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateIndex
CREATE INDEX "SalesRequestLocation_salesRequestId_idx" ON "SalesRequestLocation"("salesRequestId");

-- CreateIndex
CREATE INDEX "_LocationCloseTo_B_index" ON "_LocationCloseTo"("B");

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_salesLocationId_fkey" FOREIGN KEY ("salesLocationId") REFERENCES "SalesRequestLocation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesRequestLine" ADD CONSTRAINT "SalesRequestLine_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "SalesRequestLocation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesRequestLocation" ADD CONSTRAINT "SalesRequestLocation_salesRequestId_fkey" FOREIGN KEY ("salesRequestId") REFERENCES "SalesRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesRequestPoint" ADD CONSTRAINT "SalesRequestPoint_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "SalesRequestLocation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_LocationCloseTo" ADD CONSTRAINT "_LocationCloseTo_A_fkey" FOREIGN KEY ("A") REFERENCES "PlaceOfInterest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_LocationCloseTo" ADD CONSTRAINT "_LocationCloseTo_B_fkey" FOREIGN KEY ("B") REFERENCES "SalesRequestLocation"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Every request that has details today gets one location holding all of them
-- (doc §4.11): its units, its places and its sourcing task.
INSERT INTO "SalesRequestLocation" ("id", "salesRequestId", "position")
SELECT 'loc_' || r."id", r."id", 0
FROM "SalesRequest" r
WHERE r."detailedAt" IS NOT NULL
   OR EXISTS (SELECT 1 FROM "SalesRequestLine" l WHERE l."salesRequestId" = r."id")
   OR EXISTS (SELECT 1 FROM "SalesRequestPoint" p WHERE p."salesRequestId" = r."id")
   OR EXISTS (SELECT 1 FROM "_SalesRequestCloseTo" c WHERE c."B" = r."id");

UPDATE "SalesRequestLine" SET "locationId" = 'loc_' || "salesRequestId"
WHERE EXISTS (SELECT 1 FROM "SalesRequestLocation" x WHERE x."id" = 'loc_' || "SalesRequestLine"."salesRequestId");

UPDATE "SalesRequestPoint" SET "locationId" = 'loc_' || "salesRequestId"
WHERE EXISTS (SELECT 1 FROM "SalesRequestLocation" x WHERE x."id" = 'loc_' || "SalesRequestPoint"."salesRequestId");

INSERT INTO "_LocationCloseTo" ("A", "B")
SELECT c."A", 'loc_' || c."B" FROM "_SalesRequestCloseTo" c
WHERE EXISTS (SELECT 1 FROM "SalesRequestLocation" x WHERE x."id" = 'loc_' || c."B");

UPDATE "Task" t SET "salesLocationId" = 'loc_' || t."salesRequestId"
FROM "TaskType" ty
WHERE t."typeId" = ty."id" AND lower(ty."name") = 'sourcing' AND t."salesRequestId" IS NOT NULL
  AND EXISTS (SELECT 1 FROM "SalesRequestLocation" x WHERE x."id" = 'loc_' || t."salesRequestId");
