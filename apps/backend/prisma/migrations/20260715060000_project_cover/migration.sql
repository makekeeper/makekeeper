-- F3 follow-up: let the user pin a specific image as the project cover instead
-- of always using the first uploaded photo. Flat FK (no constraint), nullable —
-- a null/stale value falls back to the earliest image. Additive/safe.
ALTER TABLE "Project" ADD COLUMN "coverAttachmentId" TEXT;
