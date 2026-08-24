-- Give an inventory photo a real link to its component (#125).
--
-- Until now the only trace was the denormalized `Component.imageUrl` string, so
-- the attachment had no parent — which is why it could not follow a component
-- into a shared scope, and why the disk report could only file it under
-- "not attached".
ALTER TABLE "Attachment" ADD COLUMN "componentId" TEXT;
CREATE INDEX "Attachment_componentId_idx" ON "Attachment"("componentId");

-- Backfill from the URL that has been carrying the link all along:
-- `/api/uploads/att_<uuid>` → the attachment id.
UPDATE "Attachment" a
SET "componentId" = c.id
FROM "Component" c
WHERE c."imageUrl" IS NOT NULL
  AND a.id = substring(c."imageUrl" from '/api/uploads/([^/?#]+)$');
