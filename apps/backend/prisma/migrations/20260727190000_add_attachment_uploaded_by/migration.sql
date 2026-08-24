-- Split "who uploaded this" from "who this belongs to" (#125).
--
-- `scopeId` used to answer both, which worked only while a file always belonged
-- to its uploader. Once a file follows its parent, a grantee adding a file to a
-- shared project produces a row the PROJECT owns and the GRANTEE added, and one
-- column cannot hold both. `uploadedByUserId` is attribution only — nothing
-- consults it for visibility, that stays `scopeId` alone.
ALTER TABLE "Attachment" ADD COLUMN "uploadedByUserId" TEXT;

CREATE INDEX "Attachment_uploadedByUserId_idx" ON "Attachment"("uploadedByUserId");

-- Seed the attribution from the old dual-purpose column, BEFORE the re-home
-- that follows moves any more rows off their uploader.
--
-- Honest caveat: for the rows `20260727181000` already re-homed, `scopeId` is
-- now the scope owner rather than the uploader, so those are attributed to the
-- owner. That is wrong only for a file a grantee had added to a shared project
-- before #125 — a case that was already broken (the owner could not see the
-- file at all). Every single-user install, and every file uploaded by the scope
-- owner, is attributed correctly.
UPDATE "Attachment"
SET "uploadedByUserId" = "scopeId"
WHERE "uploadedByUserId" IS NULL
  AND "scopeId" IS NOT NULL;
