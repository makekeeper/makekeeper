-- CreateTable
CREATE TABLE "StatsDaily" (
    "id" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "pluginId" TEXT NOT NULL,
    "metricKey" TEXT NOT NULL,
    "dimensions" TEXT,
    "value" DOUBLE PRECISION NOT NULL,
    "scopeId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StatsDaily_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "StatsDaily_scopeId_idx" ON "StatsDaily"("scopeId");

-- CreateIndex
CREATE INDEX "StatsDaily_pluginId_metricKey_date_idx" ON "StatsDaily"("pluginId", "metricKey", "date");

-- CreateIndex
CREATE UNIQUE INDEX "StatsDaily_date_pluginId_metricKey_dimensions_scopeId_key" ON "StatsDaily"("date", "pluginId", "metricKey", "dimensions", "scopeId");
