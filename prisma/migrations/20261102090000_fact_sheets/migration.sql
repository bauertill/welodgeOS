-- CreateTable
CREATE TABLE "FactSheet" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "fileUrl" TEXT,
    "fileName" TEXT,
    "fileSize" INTEGER,
    "linkUrl" TEXT,
    "token" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FactSheet_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FactSheetDownload" (
    "id" TEXT NOT NULL,
    "factSheetId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FactSheetDownload_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "FactSheet_token_key" ON "FactSheet"("token");

-- CreateIndex
CREATE INDEX "FactSheetDownload_factSheetId_createdAt_idx" ON "FactSheetDownload"("factSheetId", "createdAt");

-- CreateIndex
CREATE INDEX "FactSheetDownload_email_idx" ON "FactSheetDownload"("email");

-- AddForeignKey
ALTER TABLE "FactSheet" ADD CONSTRAINT "FactSheet_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FactSheetDownload" ADD CONSTRAINT "FactSheetDownload_factSheetId_fkey" FOREIGN KEY ("factSheetId") REFERENCES "FactSheet"("id") ON DELETE CASCADE ON UPDATE CASCADE;

