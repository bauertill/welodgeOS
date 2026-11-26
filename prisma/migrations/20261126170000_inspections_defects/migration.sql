-- CreateEnum
CREATE TYPE "InspectionStatus" AS ENUM ('PLANNED', 'IN_PROGRESS', 'DONE');

-- CreateEnum
CREATE TYPE "DefectSeverity" AS ENUM ('BEFORE_CHECK_IN', 'MUST_FIX', 'DOCUMENT', 'NOT_SURE');

-- CreateEnum
CREATE TYPE "DefectStatus" AS ENUM ('OPEN', 'FIXED', 'CHECKED');

-- AlterTable
ALTER TABLE "RoomCategory" ADD COLUMN     "checklist" JSONB;

-- CreateTable
CREATE TABLE "ChecklistTemplate" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sections" JSONB NOT NULL,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ChecklistTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Inspection" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "slotId" TEXT NOT NULL,
    "status" "InspectionStatus" NOT NULL DEFAULT 'PLANNED',
    "scheduledOn" DATE,
    "inspectorId" TEXT,
    "checklist" JSONB NOT NULL,
    "memo" TEXT,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "taskId" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Inspection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InspectionResult" (
    "inspectionId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "ok" BOOLEAN,
    "count" INTEGER,
    "note" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InspectionResult_pkey" PRIMARY KEY ("inspectionId","itemId")
);

-- CreateTable
CREATE TABLE "InspectionPhoto" (
    "id" TEXT NOT NULL,
    "inspectionId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "name" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InspectionPhoto_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Defect" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "slotId" TEXT NOT NULL,
    "inspectionId" TEXT,
    "itemId" TEXT,
    "area" TEXT,
    "description" TEXT NOT NULL,
    "severity" "DefectSeverity" NOT NULL DEFAULT 'NOT_SURE',
    "status" "DefectStatus" NOT NULL DEFAULT 'OPEN',
    "photos" JSONB NOT NULL DEFAULT '[]',
    "taskId" TEXT,
    "fixedAt" TIMESTAMP(3),
    "checkedAt" TIMESTAMP(3),
    "checkedById" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Defect_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ChecklistTemplate_name_key" ON "ChecklistTemplate"("name");

-- CreateIndex
CREATE UNIQUE INDEX "Inspection_taskId_key" ON "Inspection"("taskId");

-- CreateIndex
CREATE INDEX "Inspection_eventId_idx" ON "Inspection"("eventId");

-- CreateIndex
CREATE INDEX "Inspection_slotId_idx" ON "Inspection"("slotId");

-- CreateIndex
CREATE INDEX "InspectionPhoto_inspectionId_idx" ON "InspectionPhoto"("inspectionId");

-- CreateIndex
CREATE UNIQUE INDEX "Defect_taskId_key" ON "Defect"("taskId");

-- CreateIndex
CREATE INDEX "Defect_eventId_status_idx" ON "Defect"("eventId", "status");

-- CreateIndex
CREATE INDEX "Defect_slotId_idx" ON "Defect"("slotId");

-- AddForeignKey
ALTER TABLE "ChecklistTemplate" ADD CONSTRAINT "ChecklistTemplate_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Inspection" ADD CONSTRAINT "Inspection_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Inspection" ADD CONSTRAINT "Inspection_slotId_fkey" FOREIGN KEY ("slotId") REFERENCES "RoomSlot"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Inspection" ADD CONSTRAINT "Inspection_inspectorId_fkey" FOREIGN KEY ("inspectorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Inspection" ADD CONSTRAINT "Inspection_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Inspection" ADD CONSTRAINT "Inspection_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InspectionResult" ADD CONSTRAINT "InspectionResult_inspectionId_fkey" FOREIGN KEY ("inspectionId") REFERENCES "Inspection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InspectionPhoto" ADD CONSTRAINT "InspectionPhoto_inspectionId_fkey" FOREIGN KEY ("inspectionId") REFERENCES "Inspection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Defect" ADD CONSTRAINT "Defect_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Defect" ADD CONSTRAINT "Defect_slotId_fkey" FOREIGN KEY ("slotId") REFERENCES "RoomSlot"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Defect" ADD CONSTRAINT "Defect_inspectionId_fkey" FOREIGN KEY ("inspectionId") REFERENCES "Inspection"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Defect" ADD CONSTRAINT "Defect_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Defect" ADD CONSTRAINT "Defect_checkedById_fkey" FOREIGN KEY ("checkedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Defect" ADD CONSTRAINT "Defect_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

