-- CreateEnum
CREATE TYPE "SiteVisitVerdict" AS ENUM ('STRONG', 'NEEDS_WORK', 'NOT_READY', 'NO_GO');

-- CreateTable
CREATE TABLE "SiteVisit" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "visitedOn" DATE NOT NULL,
    "visitors" TEXT,
    "guide" TEXT,
    "summary" TEXT,
    "eventId" TEXT,
    "providerId" TEXT,
    "authorId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SiteVisit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SiteVisitUnit" (
    "id" TEXT NOT NULL,
    "visitId" TEXT NOT NULL,
    "propertyId" TEXT,
    "label" TEXT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "verdict" "SiteVisitVerdict",
    "verdictNote" TEXT,
    "conclusion" TEXT,
    "notes" TEXT,
    "glance" JSONB NOT NULL DEFAULT '[]',
    "areas" JSONB NOT NULL DEFAULT '[]',
    "issues" JSONB NOT NULL DEFAULT '[]',
    "videos" JSONB NOT NULL DEFAULT '[]',

    CONSTRAINT "SiteVisitUnit_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SiteVisit_eventId_idx" ON "SiteVisit"("eventId");

-- CreateIndex
CREATE INDEX "SiteVisit_providerId_idx" ON "SiteVisit"("providerId");

-- CreateIndex
CREATE INDEX "SiteVisitUnit_visitId_idx" ON "SiteVisitUnit"("visitId");

-- CreateIndex
CREATE INDEX "SiteVisitUnit_propertyId_idx" ON "SiteVisitUnit"("propertyId");

-- AddForeignKey
ALTER TABLE "SiteVisit" ADD CONSTRAINT "SiteVisit_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SiteVisit" ADD CONSTRAINT "SiteVisit_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "Provider"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SiteVisit" ADD CONSTRAINT "SiteVisit_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SiteVisitUnit" ADD CONSTRAINT "SiteVisitUnit_visitId_fkey" FOREIGN KEY ("visitId") REFERENCES "SiteVisit"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SiteVisitUnit" ADD CONSTRAINT "SiteVisitUnit_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property"("id") ON DELETE SET NULL ON UPDATE CASCADE;

