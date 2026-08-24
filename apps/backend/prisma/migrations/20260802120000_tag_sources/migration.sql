-- "The value of this field becomes a tag" moves from inventory to tags (#205).
--
-- The flag shipped as a column on `CategoryProperty`, which made the inventory
-- plugin own a feature belonging to another plugin: it stored the marking, drew
-- the switch, and decided whether to show it by asking whether tags was enabled.
-- Ownership is inverted here. The marking becomes a row in the tags plugin's own
-- table, keyed by the property's canonical ORef, so tags gains no foreign key
-- into inventory's schema and inventory keeps no column about tags.

CREATE TABLE "TagSource" (
    "id" TEXT NOT NULL,
    "ref" TEXT NOT NULL,
    "scopeId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TagSource_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TagSource_ref_idx" ON "TagSource"("ref");

-- CreateIndex
CREATE INDEX "TagSource_scopeId_idx" ON "TagSource"("scopeId");

-- CreateIndex
CREATE UNIQUE INDEX "TagSource_scopeId_ref_key" ON "TagSource"("scopeId", "ref");

-- Data migration: every property already marked keeps its marking. The scope
-- comes from the owning category, because a property has none of its own — it
-- is scoped through its category. `md5(...)` gives a deterministic id, the same
-- pattern the category backfill uses, so re-running changes nothing.
INSERT INTO "TagSource" ("id", "ref", "scopeId", "createdAt")
SELECT
    md5('tagsource:' || p."id"),
    'mk://inventory/category-property/' || p."id",
    ic."scopeId",
    CURRENT_TIMESTAMP
FROM "CategoryProperty" p
JOIN "ItemCategory" ic ON ic."id" = p."categoryId"
WHERE p."isTag" = true;

-- DropColumn: nothing in inventory reads this any more.
ALTER TABLE "CategoryProperty" DROP COLUMN "isTag";
