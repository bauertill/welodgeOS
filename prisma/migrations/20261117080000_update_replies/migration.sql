-- AlterEnum
ALTER TYPE "NotificationKind" ADD VALUE 'UPDATE_REPLY';

-- AlterTable
ALTER TABLE "Update" ADD COLUMN     "parentId" TEXT;

-- CreateIndex
CREATE INDEX "Update_parentId_idx" ON "Update"("parentId");

-- AddForeignKey
ALTER TABLE "Update" ADD CONSTRAINT "Update_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "Update"("id") ON DELETE CASCADE ON UPDATE CASCADE;

