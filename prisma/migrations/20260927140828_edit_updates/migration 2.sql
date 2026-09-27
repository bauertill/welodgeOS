-- An update can now be edited by its author (doc §2.6). The edit time is
-- recorded on the update, and every earlier wording is kept in its own table,
-- so nothing that was said is lost. Purely additive.

-- AlterTable
ALTER TABLE "Update" ADD COLUMN     "editedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "UpdateRevision" (
    "id" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "replacedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updateId" TEXT NOT NULL,

    CONSTRAINT "UpdateRevision_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "UpdateRevision_updateId_idx" ON "UpdateRevision"("updateId");

-- AddForeignKey
ALTER TABLE "UpdateRevision" ADD CONSTRAINT "UpdateRevision_updateId_fkey" FOREIGN KEY ("updateId") REFERENCES "Update"("id") ON DELETE CASCADE ON UPDATE CASCADE;
