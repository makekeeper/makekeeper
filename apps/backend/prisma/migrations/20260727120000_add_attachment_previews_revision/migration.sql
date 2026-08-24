-- Which revision of the preview profile produced a row's renditions (#115).
--
-- A stored rendition path is authoritative — the on-demand render (#117) only
-- fills in what is missing — so without this a change to the profile (edge,
-- quality, format) would leave every existing photo on its old preview forever.
--
-- Existing rows are stamped with the current revision: their renditions WERE
-- made by the profile as it stands today, so marking them stale would re-render
-- the whole library for nothing.
ALTER TABLE "Attachment" ADD COLUMN "previewsRevision" INTEGER NOT NULL DEFAULT 1;
