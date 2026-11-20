-- CreateTable
CREATE TABLE "StaggerScenario" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "event" TEXT,
    "clientLabel" TEXT,
    "data" JSONB NOT NULL,
    "shareToken" TEXT,
    "shareEnabled" BOOLEAN NOT NULL DEFAULT false,
    "archived" BOOLEAN NOT NULL DEFAULT false,
    "createdById" TEXT,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StaggerScenario_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "StaggerScenario_shareToken_key" ON "StaggerScenario"("shareToken");

-- CreateIndex
CREATE INDEX "StaggerScenario_archived_updatedAt_idx" ON "StaggerScenario"("archived", "updatedAt");

-- AddForeignKey
ALTER TABLE "StaggerScenario" ADD CONSTRAINT "StaggerScenario_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StaggerScenario" ADD CONSTRAINT "StaggerScenario_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- The first scenario (doc §4.12): Decron Properties' 50 apartments for OBS at
-- LA28, as the reference page's defaults() — kept in the migration so every
-- database gets it without anyone running a seed.
INSERT INTO "StaggerScenario" ("id", "name", "event", "clientLabel", "data", "updatedAt")
VALUES (
  'stagger_decron_obs_50',
  'Decron – OBS 50 units',
  'LA28',
  'Decron Properties',
  '{"units":50,"first":"2028-03-01","waves":6,"gap":14,"stay":6,"mix":{"studio":20,"one":60,"two":20},"rates":{"studio":4000,"one":4500,"two":5500},"showBlock":true,"showRent":true,"rateBasis":"month","rows":[{"date":"2028-03-01","units":9,"stay":6},{"date":"2028-03-15","units":9,"stay":6},{"date":"2028-03-29","units":8,"stay":6},{"date":"2028-04-12","units":8,"stay":6},{"date":"2028-04-26","units":8,"stay":6},{"date":"2028-05-10","units":8,"stay":6}]}'::jsonb,
  CURRENT_TIMESTAMP
);
