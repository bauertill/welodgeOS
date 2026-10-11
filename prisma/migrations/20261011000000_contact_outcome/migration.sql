-- CreateEnum
CREATE TYPE "ContactOutcome" AS ENUM ('NO_AVAILABILITY', 'NO_GROUPS', 'NOT_INTERESTED');

-- AlterEnum
ALTER TYPE "UpdateKind" ADD VALUE 'CONTACT_OUTCOME';

-- AlterTable
ALTER TABLE "Task" ADD COLUMN     "outcome" "ContactOutcome",
ADD COLUMN     "outcomeNote" TEXT;

