-- An intake draft holds a SET of frames, not one photograph (#216, epic #212).
--
-- A part is identified from several angles: the marking on one face, the
-- footprint on another, the packaging label on a third. The draft's single
-- `imageUrl` string could carry exactly one, and — like the item column removed
-- in #213 — it had no parent row, so the frames belonged to nobody.

ALTER TABLE "Attachment" ADD COLUMN "intakeDraftId" TEXT;
CREATE INDEX "Attachment_intakeDraftId_idx" ON "Attachment"("intakeDraftId");

-- Per-FRAME idempotency for the offline queue. `InventoryIntakeDraft.clientOpId`
-- can only speak for the shot that created the draft; every later frame of the
-- same item needs its own key, or a re-drained queue doubles the photographs.
ALTER TABLE "Attachment" ADD COLUMN "clientOpId" TEXT;
CREATE UNIQUE INDEX "Attachment_clientOpId_key" ON "Attachment"("clientOpId");

-- Carry every existing draft over to one frame each. The attachment already
-- exists (the capture route stored it); all it lacks is the link back. Only a
-- row with no parent of its own is adopted — a URL pointing at somebody else's
-- file must not re-home that file.
-- `scopeId` is restamped with the draft's, for the same reason the item
-- migration restamps: a parented file belongs to its parent's scope (#125), and
-- a frame left on its uploader's stamp would be invisible to everybody the
-- draft is shared with.
UPDATE "Attachment" a
SET "intakeDraftId" = d."id",
    "scopeId" = d."scopeId",
    "ownerPluginId" = COALESCE(a."ownerPluginId", 'inventory')
FROM "InventoryIntakeDraft" d
WHERE d."imageUrl" IS NOT NULL
  AND a."id" = regexp_replace(d."imageUrl", '^.*/api/uploads/', '')
  AND a."componentId" IS NULL
  AND a."projectId" IS NULL
  AND a."intakeDraftId" IS NULL;

ALTER TABLE "InventoryIntakeDraft" DROP COLUMN "imageUrl";
