-- What a client asks for becomes lines (doc §4.11): rooms of a type, for so
-- many people each, from arrival to departure — a line per room type and per
-- period, so a pre period or a second room type is another line. What a
-- request already said in its one rooms/arrival/departure moves into its first
-- line before those go.

-- CreateTable
CREATE TABLE "SalesRequestLine" (
    "id" TEXT NOT NULL,
    "salesRequestId" TEXT NOT NULL,
    "rooms" INTEGER NOT NULL,
    "roomType" TEXT,
    "occupancy" INTEGER,
    "checkIn" DATE,
    "checkOut" DATE,
    "position" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "SalesRequestLine_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SalesRequestLine_salesRequestId_idx" ON "SalesRequestLine"("salesRequestId");

-- AddForeignKey
ALTER TABLE "SalesRequestLine" ADD CONSTRAINT "SalesRequestLine_salesRequestId_fkey" FOREIGN KEY ("salesRequestId") REFERENCES "SalesRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- The move: one line from what each request already had.
INSERT INTO "SalesRequestLine" ("id", "salesRequestId", "rooms", "checkIn", "checkOut", "position")
SELECT gen_random_uuid()::text, "id", COALESCE("roomCount", 0), "checkIn", "checkOut", 0
FROM "SalesRequest"
WHERE "roomCount" IS NOT NULL OR "checkIn" IS NOT NULL OR "checkOut" IS NOT NULL;

-- AlterTable
ALTER TABLE "SalesRequest" DROP COLUMN "checkIn",
DROP COLUMN "checkOut",
DROP COLUMN "roomCount";
