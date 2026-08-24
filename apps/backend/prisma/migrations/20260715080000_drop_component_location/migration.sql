-- #53: the free-text Component.location is removed — placement is the
-- structured storage link (storageId + storageRow/storageCol) only.
-- DESTRUCTIVE for the column itself; existing non-empty values are preserved
-- by appending them to the component description first.
UPDATE "Component"
SET "description" = COALESCE("description", '') || '<p>' || "location" || '</p>'
WHERE COALESCE("location", '') <> '';

ALTER TABLE "Component" DROP COLUMN "location";
