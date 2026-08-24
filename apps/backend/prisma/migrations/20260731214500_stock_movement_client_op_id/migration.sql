-- Idempotency for queued offline stock writes (#202). A phone that drains its
-- queue after a timeout must record one movement, not two; the unique index is
-- what makes the replay a no-op instead of a second deduction.
ALTER TABLE "StockMovement" ADD COLUMN "clientOpId" TEXT;

CREATE UNIQUE INDEX "StockMovement_clientOpId_key" ON "StockMovement"("clientOpId");

-- The same key on intake drafts: draining a queued shot twice must not produce
-- two drafts of one photograph.
ALTER TABLE "InventoryIntakeDraft" ADD COLUMN "clientOpId" TEXT;

CREATE UNIQUE INDEX "InventoryIntakeDraft_clientOpId_key" ON "InventoryIntakeDraft"("clientOpId");
