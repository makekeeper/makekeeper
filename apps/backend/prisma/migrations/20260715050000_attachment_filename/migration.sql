-- F3 follow-up: attachments can now be any file (3D models, code, archives),
-- not just images. Store the original upload filename so non-image files are
-- identifiable and downloadable under their real name. Nullable/additive.
ALTER TABLE "Attachment" ADD COLUMN "filename" TEXT;
