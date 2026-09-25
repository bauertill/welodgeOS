-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "public"."AcquisitionState" AS ENUM ('NONE', 'IN_PROGRESS', 'OPTION', 'BOUGHT', 'RELEASED');

-- CreateEnum
CREATE TYPE "public"."CategoryContractStatus" AS ENUM ('IN_NEGOTIATION', 'IN_CONTRACTING', 'CONTRACTED');

-- CreateEnum
CREATE TYPE "public"."EventStatus" AS ENUM ('PLANNING', 'ACTIVE', 'CLOSED');

-- CreateEnum
CREATE TYPE "public"."LedgerAxis" AS ENUM ('INVENTORY', 'ACQUISITION', 'SALES', 'REQUEST');

-- CreateEnum
CREATE TYPE "public"."PropertyType" AS ENUM ('HOTEL', 'APARTMENT', 'APARTHOTEL');

-- CreateEnum
CREATE TYPE "public"."SalesState" AS ENUM ('NONE', 'REQUESTED', 'BLOCKED', 'SOLD', 'CANCELLED');

-- CreateEnum
CREATE TYPE "public"."ScoutingStatus" AS ENUM ('PROSPECT', 'CONTACTED', 'SHORTLISTED', 'REJECTED', 'CONTRACTED');

-- CreateTable
CREATE TABLE "public"."Account" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "providerAccountId" TEXT NOT NULL,
    "refresh_token" TEXT,
    "access_token" TEXT,
    "expires_at" INTEGER,
    "token_type" TEXT,
    "scope" TEXT,
    "id_token" TEXT,
    "session_state" TEXT,
    "refresh_token_expires_in" INTEGER,

    CONSTRAINT "Account_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Amenity" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "Amenity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."AuditEntry" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actorId" TEXT,
    "entity" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "changes" TEXT,

    CONSTRAINT "AuditEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."CategoryContract" (
    "id" TEXT NOT NULL,
    "status" "public"."CategoryContractStatus" NOT NULL DEFAULT 'IN_NEGOTIATION',
    "scoutingEntryId" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CategoryContract_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Client" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "shortName" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Client_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Event" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "city" TEXT,
    "country" TEXT,
    "startDate" DATE NOT NULL,
    "endDate" DATE NOT NULL,
    "status" "public"."EventStatus" NOT NULL DEFAULT 'PLANNING',
    "venueName" TEXT,
    "venueLatitude" DOUBLE PRECISION,
    "venueLongitude" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Event_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."LedgerEntry" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "axis" "public"."LedgerAxis" NOT NULL,
    "fromState" TEXT,
    "toState" TEXT,
    "summary" TEXT NOT NULL,
    "reason" TEXT,
    "nightCount" INTEGER NOT NULL,
    "actorId" TEXT,
    "eventId" TEXT NOT NULL,
    "beforeSnapshot" JSONB,
    "undoable" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "LedgerEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Property" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "public"."PropertyType" NOT NULL,
    "address" TEXT,
    "city" TEXT,
    "country" TEXT,
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "stars" INTEGER,
    "totalRooms" INTEGER,
    "website" TEXT,
    "phone" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "scoutedById" TEXT,

    CONSTRAINT "Property_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."PropertyContact" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "role" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "propertyId" TEXT NOT NULL,

    CONSTRAINT "PropertyContact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."RoomCategory" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "unitCount" INTEGER NOT NULL DEFAULT 0,
    "capacity" INTEGER NOT NULL DEFAULT 2,
    "bedConfiguration" TEXT,
    "bedrooms" INTEGER,
    "bathrooms" DOUBLE PRECISION,
    "currency" TEXT NOT NULL DEFAULT 'CHF',
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "propertyId" TEXT NOT NULL,
    "indicativePriceMaxCents" INTEGER,
    "indicativePriceMinCents" INTEGER,

    CONSTRAINT "RoomCategory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."RoomNight" (
    "id" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "slotId" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "acquisitionState" "public"."AcquisitionState" NOT NULL DEFAULT 'NONE',
    "supplierRef" TEXT,
    "optionExpiry" DATE,
    "buyPriceCents" INTEGER,
    "buyCurrency" TEXT,
    "acquisitionNotes" TEXT,
    "acquisitionOwnerId" TEXT,
    "salesState" "public"."SalesState" NOT NULL DEFAULT 'NONE',
    "clientId" TEXT,
    "clientRef" TEXT,
    "blockExpiry" DATE,
    "dueDate" DATE,
    "sellPriceCents" INTEGER,
    "sellCurrency" TEXT,
    "salesNotes" TEXT,
    "salesOwnerId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RoomNight_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."RoomNightRequest" (
    "id" TEXT NOT NULL,
    "roomNightId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "clientRef" TEXT,
    "sellPriceCents" INTEGER,
    "sellCurrency" TEXT,
    "notes" TEXT,
    "ownerId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RoomNightRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."RoomSlot" (
    "id" TEXT NOT NULL,
    "slotNumber" INTEGER NOT NULL,
    "categoryId" TEXT NOT NULL,

    CONSTRAINT "RoomSlot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."ScoutingEntry" (
    "id" TEXT NOT NULL,
    "status" "public"."ScoutingStatus" NOT NULL DEFAULT 'PROSPECT',
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "eventId" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "addedById" TEXT,

    CONSTRAINT "ScoutingEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Session" (
    "id" TEXT NOT NULL,
    "sessionToken" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "expires" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Update" (
    "id" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "authorId" TEXT,
    "propertyId" TEXT,
    "clientId" TEXT,

    CONSTRAINT "Update_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."User" (
    "id" TEXT NOT NULL,
    "name" TEXT,
    "email" TEXT,
    "emailVerified" TIMESTAMP(3),
    "image" TEXT,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."VerificationToken" (
    "identifier" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "expires" TIMESTAMP(3) NOT NULL
);

-- CreateTable
CREATE TABLE "public"."_LedgerNights" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,

    CONSTRAINT "_LedgerNights_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateTable
CREATE TABLE "public"."_PropertyAmenities" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,

    CONSTRAINT "_PropertyAmenities_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateIndex
CREATE UNIQUE INDEX "Account_provider_providerAccountId_key" ON "public"."Account"("provider" ASC, "providerAccountId" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "Amenity_key_key" ON "public"."Amenity"("key" ASC);

-- CreateIndex
CREATE INDEX "Amenity_sortOrder_idx" ON "public"."Amenity"("sortOrder" ASC);

-- CreateIndex
CREATE INDEX "AuditEntry_entity_entityId_createdAt_idx" ON "public"."AuditEntry"("entity" ASC, "entityId" ASC, "createdAt" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "CategoryContract_scoutingEntryId_categoryId_key" ON "public"."CategoryContract"("scoutingEntryId" ASC, "categoryId" ASC);

-- CreateIndex
CREATE INDEX "CategoryContract_scoutingEntryId_idx" ON "public"."CategoryContract"("scoutingEntryId" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "Client_name_key" ON "public"."Client"("name" ASC);

-- CreateIndex
CREATE INDEX "Event_startDate_idx" ON "public"."Event"("startDate" ASC);

-- CreateIndex
CREATE INDEX "LedgerEntry_eventId_createdAt_idx" ON "public"."LedgerEntry"("eventId" ASC, "createdAt" ASC);

-- CreateIndex
CREATE INDEX "Property_city_idx" ON "public"."Property"("city" ASC);

-- CreateIndex
CREATE INDEX "Property_name_idx" ON "public"."Property"("name" ASC);

-- CreateIndex
CREATE INDEX "PropertyContact_propertyId_idx" ON "public"."PropertyContact"("propertyId" ASC);

-- CreateIndex
CREATE INDEX "RoomCategory_propertyId_idx" ON "public"."RoomCategory"("propertyId" ASC);

-- CreateIndex
CREATE INDEX "RoomNight_clientId_idx" ON "public"."RoomNight"("clientId" ASC);

-- CreateIndex
CREATE INDEX "RoomNight_eventId_acquisitionState_idx" ON "public"."RoomNight"("eventId" ASC, "acquisitionState" ASC);

-- CreateIndex
CREATE INDEX "RoomNight_eventId_blockExpiry_idx" ON "public"."RoomNight"("eventId" ASC, "blockExpiry" ASC);

-- CreateIndex
CREATE INDEX "RoomNight_eventId_date_idx" ON "public"."RoomNight"("eventId" ASC, "date" ASC);

-- CreateIndex
CREATE INDEX "RoomNight_eventId_optionExpiry_idx" ON "public"."RoomNight"("eventId" ASC, "optionExpiry" ASC);

-- CreateIndex
CREATE INDEX "RoomNight_eventId_salesState_idx" ON "public"."RoomNight"("eventId" ASC, "salesState" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "RoomNight_slotId_date_key" ON "public"."RoomNight"("slotId" ASC, "date" ASC);

-- CreateIndex
CREATE INDEX "RoomNightRequest_clientId_idx" ON "public"."RoomNightRequest"("clientId" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "RoomNightRequest_roomNightId_clientId_key" ON "public"."RoomNightRequest"("roomNightId" ASC, "clientId" ASC);

-- CreateIndex
CREATE INDEX "RoomSlot_categoryId_idx" ON "public"."RoomSlot"("categoryId" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "RoomSlot_categoryId_slotNumber_key" ON "public"."RoomSlot"("categoryId" ASC, "slotNumber" ASC);

-- CreateIndex
CREATE INDEX "ScoutingEntry_eventId_idx" ON "public"."ScoutingEntry"("eventId" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "ScoutingEntry_eventId_propertyId_key" ON "public"."ScoutingEntry"("eventId" ASC, "propertyId" ASC);

-- CreateIndex
CREATE INDEX "ScoutingEntry_status_idx" ON "public"."ScoutingEntry"("status" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "Session_sessionToken_key" ON "public"."Session"("sessionToken" ASC);

-- CreateIndex
CREATE INDEX "Update_clientId_idx" ON "public"."Update"("clientId" ASC);

-- CreateIndex
CREATE INDEX "Update_propertyId_idx" ON "public"."Update"("propertyId" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "public"."User"("email" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "VerificationToken_identifier_token_key" ON "public"."VerificationToken"("identifier" ASC, "token" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "VerificationToken_token_key" ON "public"."VerificationToken"("token" ASC);

-- CreateIndex
CREATE INDEX "_LedgerNights_B_index" ON "public"."_LedgerNights"("B" ASC);

-- CreateIndex
CREATE INDEX "_PropertyAmenities_B_index" ON "public"."_PropertyAmenities"("B" ASC);

-- AddForeignKey
ALTER TABLE "public"."Account" ADD CONSTRAINT "Account_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."AuditEntry" ADD CONSTRAINT "AuditEntry_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "public"."User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."CategoryContract" ADD CONSTRAINT "CategoryContract_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "public"."RoomCategory"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."CategoryContract" ADD CONSTRAINT "CategoryContract_scoutingEntryId_fkey" FOREIGN KEY ("scoutingEntryId") REFERENCES "public"."ScoutingEntry"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."LedgerEntry" ADD CONSTRAINT "LedgerEntry_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "public"."User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."LedgerEntry" ADD CONSTRAINT "LedgerEntry_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "public"."Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Property" ADD CONSTRAINT "Property_scoutedById_fkey" FOREIGN KEY ("scoutedById") REFERENCES "public"."User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."PropertyContact" ADD CONSTRAINT "PropertyContact_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "public"."Property"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."RoomCategory" ADD CONSTRAINT "RoomCategory_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "public"."Property"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."RoomNight" ADD CONSTRAINT "RoomNight_acquisitionOwnerId_fkey" FOREIGN KEY ("acquisitionOwnerId") REFERENCES "public"."User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."RoomNight" ADD CONSTRAINT "RoomNight_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "public"."Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."RoomNight" ADD CONSTRAINT "RoomNight_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "public"."Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."RoomNight" ADD CONSTRAINT "RoomNight_salesOwnerId_fkey" FOREIGN KEY ("salesOwnerId") REFERENCES "public"."User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."RoomNight" ADD CONSTRAINT "RoomNight_slotId_fkey" FOREIGN KEY ("slotId") REFERENCES "public"."RoomSlot"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."RoomNightRequest" ADD CONSTRAINT "RoomNightRequest_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "public"."Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."RoomNightRequest" ADD CONSTRAINT "RoomNightRequest_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "public"."User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."RoomNightRequest" ADD CONSTRAINT "RoomNightRequest_roomNightId_fkey" FOREIGN KEY ("roomNightId") REFERENCES "public"."RoomNight"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."RoomSlot" ADD CONSTRAINT "RoomSlot_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "public"."RoomCategory"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."ScoutingEntry" ADD CONSTRAINT "ScoutingEntry_addedById_fkey" FOREIGN KEY ("addedById") REFERENCES "public"."User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."ScoutingEntry" ADD CONSTRAINT "ScoutingEntry_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "public"."Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."ScoutingEntry" ADD CONSTRAINT "ScoutingEntry_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "public"."Property"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Update" ADD CONSTRAINT "Update_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "public"."User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Update" ADD CONSTRAINT "Update_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "public"."Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Update" ADD CONSTRAINT "Update_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "public"."Property"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."_LedgerNights" ADD CONSTRAINT "_LedgerNights_A_fkey" FOREIGN KEY ("A") REFERENCES "public"."LedgerEntry"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."_LedgerNights" ADD CONSTRAINT "_LedgerNights_B_fkey" FOREIGN KEY ("B") REFERENCES "public"."RoomNight"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."_PropertyAmenities" ADD CONSTRAINT "_PropertyAmenities_A_fkey" FOREIGN KEY ("A") REFERENCES "public"."Amenity"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."_PropertyAmenities" ADD CONSTRAINT "_PropertyAmenities_B_fkey" FOREIGN KEY ("B") REFERENCES "public"."Property"("id") ON DELETE CASCADE ON UPDATE CASCADE;

