-- Photographed parts waiting to become inventory items (#201). Its own table,
-- not a flag on Component, so a half-finished card can never leak into a list,
-- a report or an agent tool that forgot to filter.
CREATE TABLE "InventoryIntakeDraft" (
    "id" TEXT NOT NULL,
    "scopeId" TEXT,
    "imageUrl" TEXT,
    "status" TEXT NOT NULL,
    "name" TEXT,
    "sku" TEXT,
    "category" TEXT,
    "unit" TEXT,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "storageId" TEXT,
    "storageRow" INTEGER,
    "storageCol" INTEGER,
    "errorKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InventoryIntakeDraft_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "InventoryIntakeDraft_scopeId_idx" ON "InventoryIntakeDraft"("scopeId");
CREATE INDEX "InventoryIntakeDraft_status_idx" ON "InventoryIntakeDraft"("status");
