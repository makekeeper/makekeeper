-- An item keeps a SET of photographs instead of one picture (#213, epic #212).
--
-- The pictures themselves are already `Attachment` rows keyed by `componentId`
-- (#125) — nothing read them, because the item pointed at its photo with the
-- denormalized `Component.imageUrl` string. This migration makes the attachment
-- rows the truth and the pin the only column left.

ALTER TABLE "Component" ADD COLUMN "coverAttachmentId" TEXT;

-- The phone's identity for an item being shot across several frames (#216).
ALTER TABLE "InventoryIntakeDraft" ADD COLUMN "clientDraftId" TEXT;
CREATE UNIQUE INDEX "InventoryIntakeDraft_clientDraftId_key"
  ON "InventoryIntakeDraft"("clientDraftId");

-- Backfill, in two steps and in this order.
--
-- 1. An `imageUrl` naming an attachment that predates #125 may have no
--    `componentId` at all — its only link to the item WAS the URL. Restore the
--    parent link first, so the row is a picture of the item before anything
--    tries to pin it. Only rows with no parent of their own are adopted: a URL
--    pointing at somebody else's file must not re-home that file.
--    `scopeId` is restamped with the item's, because that is what re-parenting
--    MEANS under the conditional binding of #125: a parentless file belongs to
--    whoever uploaded it, a parented one belongs to its parent's scope. Left
--    alone, a photo uploaded before #125 would keep its uploader's stamp and
--    vanish for everybody the item is shared with — the picture would be there
--    and unreadable, which is worse than absent.
UPDATE "Attachment" a
SET "componentId" = c."id",
    "scopeId" = c."scopeId",
    "ownerPluginId" = COALESCE(a."ownerPluginId", 'inventory')
FROM "Component" c
WHERE c."imageUrl" IS NOT NULL
  AND a."id" = regexp_replace(c."imageUrl", '^.*/api/uploads/', '')
  AND a."componentId" IS NULL
  AND a."projectId" IS NULL;

-- 2. Pin what the item was already showing. A URL that resolves to no
--    attachment (a dangling string, a foreign host, a `data:` leftover) leaves
--    the pin null and the item without a cover — which is what it effectively
--    had: the route would have served nothing.
UPDATE "Component" c
SET "coverAttachmentId" = a."id"
FROM "Attachment" a
WHERE c."imageUrl" IS NOT NULL
  AND a."id" = regexp_replace(c."imageUrl", '^.*/api/uploads/', '')
  AND a."componentId" = c."id";

ALTER TABLE "Component" DROP COLUMN "imageUrl";
