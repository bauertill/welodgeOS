-- AlterTable
ALTER TABLE "Property" ADD COLUMN     "guestCustom" JSONB NOT NULL DEFAULT '[]',
ADD COLUMN     "guestLinkMadeAt" TIMESTAMP(3),
ADD COLUMN     "guestLinkMadeById" TEXT,
ADD COLUMN     "guestSubmittedAt" TIMESTAMP(3),
ADD COLUMN     "guestToken" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Property_guestToken_key" ON "Property"("guestToken");

-- AddForeignKey
ALTER TABLE "Property" ADD CONSTRAINT "Property_guestLinkMadeById_fkey" FOREIGN KEY ("guestLinkMadeById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

