-- AlterTable
ALTER TABLE "RateCard" ADD COLUMN     "mapLayerIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "mapPlaceIds" TEXT[] DEFAULT ARRAY[]::TEXT[];

