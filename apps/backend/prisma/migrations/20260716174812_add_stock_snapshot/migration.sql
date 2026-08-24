-- CreateTable
CREATE TABLE "StockSnapshot" (
    "id" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "stock" DOUBLE PRECISION NOT NULL,
    "reserved" DOUBLE PRECISION NOT NULL,
    "scopeId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StockSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "StockSnapshot_scopeId_idx" ON "StockSnapshot"("scopeId");

-- CreateIndex
CREATE INDEX "StockSnapshot_date_idx" ON "StockSnapshot"("date");

-- CreateIndex
CREATE UNIQUE INDEX "StockSnapshot_date_scopeId_key" ON "StockSnapshot"("date", "scopeId");
