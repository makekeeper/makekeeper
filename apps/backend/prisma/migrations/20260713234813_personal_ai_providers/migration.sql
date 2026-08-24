-- AlterTable
ALTER TABLE "AIProviderConfig" ADD COLUMN     "ownerUserId" TEXT,
ADD COLUMN     "sharedWith" TEXT NOT NULL DEFAULT 'none';

-- AlterTable
ALTER TABLE "MultiuserSettings" ADD COLUMN     "allowPersonalProviders" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
CREATE INDEX "AIProviderConfig_ownerUserId_idx" ON "AIProviderConfig"("ownerUserId");

-- Existing connections predate ownership: they are instance-level and were
-- usable by every user — keep that behavior.
UPDATE "AIProviderConfig" SET "sharedWith" = 'everyone' WHERE "ownerUserId" IS NULL;
