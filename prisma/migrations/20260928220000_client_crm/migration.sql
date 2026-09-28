-- Clients become the sales CRM (doc §4.10): a client gains a category, an
-- account manager and its general phone, email and website, and the people
-- who work there are recorded as its contacts. Existing clients keep
-- everything they have; the new details start empty.

-- CreateEnum
CREATE TYPE "ClientCategory" AS ENUM ('BROADCASTER', 'FEDERATION', 'SPONSOR', 'EVENT_ORGANISER', 'AGENCY', 'CORPORATE', 'OTHER');

-- CreateEnum
CREATE TYPE "ContactType" AS ENUM ('LEAD', 'QUALIFIED_LEAD', 'CUSTOMER', 'PARTNER', 'OTHER');

-- CreateEnum
CREATE TYPE "Priority" AS ENUM ('HIGH', 'MEDIUM', 'LOW');

-- AlterTable
ALTER TABLE "Client" ADD COLUMN     "accountManagerId" TEXT,
ADD COLUMN     "category" "ClientCategory",
ADD COLUMN     "email" TEXT,
ADD COLUMN     "phone" TEXT,
ADD COLUMN     "website" TEXT;

-- CreateTable
CREATE TABLE "ClientContact" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "title" TEXT,
    "email" TEXT,
    "mobile" TEXT,
    "phone" TEXT,
    "type" "ContactType",
    "priority" "Priority",
    "comments" TEXT,
    "accountManagerId" TEXT,
    "clientId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ClientContact_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ClientContact_clientId_idx" ON "ClientContact"("clientId");

-- CreateIndex
CREATE INDEX "ClientContact_email_idx" ON "ClientContact"("email");

-- AddForeignKey
ALTER TABLE "Client" ADD CONSTRAINT "Client_accountManagerId_fkey" FOREIGN KEY ("accountManagerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientContact" ADD CONSTRAINT "ClientContact_accountManagerId_fkey" FOREIGN KEY ("accountManagerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientContact" ADD CONSTRAINT "ClientContact_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;

