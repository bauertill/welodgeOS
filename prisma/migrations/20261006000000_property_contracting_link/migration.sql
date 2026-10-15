-- AlterEnum
ALTER TYPE "NotificationKind" ADD VALUE 'PROPERTY_CONTRACTING_SENT';

-- AlterTable
ALTER TABLE "Property" ADD COLUMN     "contractingLinkMadeAt" TIMESTAMP(3),
ADD COLUMN     "contractingLinkMadeById" TEXT,
ADD COLUMN     "contractingSubmittedAt" TIMESTAMP(3),
ADD COLUMN     "contractingToken" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Property_contractingToken_key" ON "Property"("contractingToken");

-- AddForeignKey
ALTER TABLE "Property" ADD CONSTRAINT "Property_contractingLinkMadeById_fkey" FOREIGN KEY ("contractingLinkMadeById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

