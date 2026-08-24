-- Every upload declares the plugin it belongs to (#120). Until now the disk
-- report inferred ownership from whichever id column was set, so an inventory
-- photo — referenced only by a denormalized URL — belonged to nobody.
--
-- Additive and nullable: existing rows keep working. They are backfilled from
-- the id columns where those say something, and stay NULL where they do not;
-- the report shows that remainder as undetermined rather than guessing.

-- AlterTable
ALTER TABLE "Attachment" ADD COLUMN "ownerPluginId" TEXT;

-- Backfill what the old columns can honestly answer.
UPDATE "Attachment" SET "ownerPluginId" = 'projects' WHERE "projectId" IS NOT NULL;
UPDATE "Attachment" SET "ownerPluginId" = 'chat' WHERE "ownerPluginId" IS NULL AND "sessionId" IS NOT NULL;
UPDATE "Attachment" SET "ownerPluginId" = 'phone-bridge' WHERE "ownerPluginId" IS NULL AND "bridgeSessionId" IS NOT NULL;

-- CreateIndex
CREATE INDEX "Attachment_ownerPluginId_idx" ON "Attachment"("ownerPluginId");
