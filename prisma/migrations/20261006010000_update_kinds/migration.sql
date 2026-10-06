-- CreateEnum
CREATE TYPE "UpdateKind" AS ENUM ('NOTE', 'MEETING', 'CALL', 'SITE_INSPECTION');

-- AlterTable
ALTER TABLE "Update" ADD COLUMN     "happenedOn" DATE,
ADD COLUMN     "kind" "UpdateKind" NOT NULL DEFAULT 'NOTE';

