-- Mobile intake stops guessing a category name and picks one from the tree (#206).
ALTER TABLE "InventoryIntakeDraft" ADD COLUMN "categoryId" TEXT;
ALTER TABLE "InventoryIntakeDraft" ADD COLUMN "description" TEXT;
ALTER TABLE "InventoryIntakeDraft" ADD COLUMN "propertyValues" TEXT;

-- Carry over what the free-text column already held, by the same rule the commit
-- path applied at the time: an exact, case-insensitive name match, within the
-- draft's own scope. A name that matches nothing leaves the draft uncategorised,
-- which is what committing it would have done anyway.
UPDATE "InventoryIntakeDraft" d
SET "categoryId" = c."id"
FROM "ItemCategory" c
WHERE d."category" IS NOT NULL
  AND lower(c."name") = lower(d."category")
  AND c."scopeId" IS NOT DISTINCT FROM d."scopeId";

-- A name that matched nothing is NOT thrown away. It is the only record of what
-- somebody wrote about that draft, and the tree cannot be extended from here —
-- so it moves into the description, where the human confirming the batch sees
-- it and can pick a real category. Dropping the column with the text still in
-- it would delete work nobody could get back.
UPDATE "InventoryIntakeDraft"
SET "description" = "category"
WHERE "category" IS NOT NULL
  AND trim("category") <> ''
  AND "categoryId" IS NULL;

ALTER TABLE "InventoryIntakeDraft" DROP COLUMN "category";
