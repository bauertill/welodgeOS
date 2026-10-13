-- Lines drawn on an event's map — metro and light rail (doc §3.7).
-- CreateTable
CREATE TABLE "MapLine" (
    "id" TEXT NOT NULL,
    "layerId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "ref" TEXT,
    "color" TEXT NOT NULL,
    "path" JSONB NOT NULL,

    CONSTRAINT "MapLine_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MapLine_layerId_idx" ON "MapLine"("layerId");

-- AddForeignKey
ALTER TABLE "MapLine" ADD CONSTRAINT "MapLine_layerId_fkey" FOREIGN KEY ("layerId") REFERENCES "MapLayer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

