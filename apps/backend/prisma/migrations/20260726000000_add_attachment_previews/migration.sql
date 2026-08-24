-- Preview renditions for stored images (#113). Additive and nullable: existing
-- attachments keep working, they simply have no derivative and the serving
-- route falls back to the original for them.
--
-- `isImage` records the result of probing the bytes with a decoder at upload
-- time, replacing the mime-prefix guess that made an undecodable upload (HEIC,
-- corrupt file) render as a broken <img>. Null on pre-existing rows, where
-- callers keep using the old mime-prefix rule.

-- AlterTable
ALTER TABLE "Attachment" ADD COLUMN "previewXsPath" TEXT;
ALTER TABLE "Attachment" ADD COLUMN "previewSmPath" TEXT;
ALTER TABLE "Attachment" ADD COLUMN "previewLgPath" TEXT;
ALTER TABLE "Attachment" ADD COLUMN "isImage" BOOLEAN;
