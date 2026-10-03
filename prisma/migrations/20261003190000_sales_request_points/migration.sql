-- Places a client wants to be close to, of their own (doc §4.11): found by
-- address or picked on a map, each with a position to measure from.

-- CreateTable
CREATE TABLE "SalesRequestPoint" (
    "id" TEXT NOT NULL,
    "salesRequestId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "address" TEXT,
    "latitude" DOUBLE PRECISION NOT NULL,
    "longitude" DOUBLE PRECISION NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "SalesRequestPoint_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SalesRequestPoint_salesRequestId_idx" ON "SalesRequestPoint"("salesRequestId");

-- AddForeignKey
ALTER TABLE "SalesRequestPoint" ADD CONSTRAINT "SalesRequestPoint_salesRequestId_fkey" FOREIGN KEY ("salesRequestId") REFERENCES "SalesRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

