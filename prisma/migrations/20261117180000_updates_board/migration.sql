-- AlterTable
ALTER TABLE "Update" ADD COLUMN     "fileUrl" TEXT,
ADD COLUMN     "otherProvider" TEXT,
ADD COLUMN     "providerId" TEXT;

-- CreateTable
CREATE TABLE "UpdateBoardSeen" (
    "userId" TEXT NOT NULL,
    "tab" TEXT NOT NULL,
    "seenAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UpdateBoardSeen_pkey" PRIMARY KEY ("userId","tab")
);

-- CreateIndex
CREATE INDEX "Update_providerId_idx" ON "Update"("providerId");

-- CreateIndex
CREATE INDEX "Update_createdAt_idx" ON "Update"("createdAt");

-- AddForeignKey
ALTER TABLE "Update" ADD CONSTRAINT "Update_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "Provider"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UpdateBoardSeen" ADD CONSTRAINT "UpdateBoardSeen_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

