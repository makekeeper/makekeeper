-- Category tree that owns a typed property set (#205). The category IS the
-- template: no separate template entity, so there is nothing to keep in sync.

-- CreateTable
CREATE TABLE "ItemCategory" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "parentId" TEXT,
    "inheritProperties" BOOLEAN NOT NULL DEFAULT true,
    "order" INTEGER NOT NULL DEFAULT 0,
    "scopeId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ItemCategory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CategoryProperty" (
    "id" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "unit" TEXT,
    "required" BOOLEAN NOT NULL DEFAULT false,
    "options" TEXT,
    "isTag" BOOLEAN NOT NULL DEFAULT false,
    "order" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CategoryProperty_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ComponentPropertyValue" (
    "id" TEXT NOT NULL,
    "componentId" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "valueText" TEXT,
    "valueNumber" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ComponentPropertyValue_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ItemCategory_parentId_idx" ON "ItemCategory"("parentId");

-- CreateIndex
CREATE INDEX "ItemCategory_scopeId_idx" ON "ItemCategory"("scopeId");

-- CreateIndex
CREATE INDEX "CategoryProperty_categoryId_idx" ON "CategoryProperty"("categoryId");

-- CreateIndex
CREATE INDEX "ComponentPropertyValue_componentId_idx" ON "ComponentPropertyValue"("componentId");

-- CreateIndex
CREATE INDEX "ComponentPropertyValue_propertyId_idx" ON "ComponentPropertyValue"("propertyId");

-- CreateIndex
CREATE UNIQUE INDEX "ComponentPropertyValue_componentId_propertyId_key" ON "ComponentPropertyValue"("componentId", "propertyId");

-- AddForeignKey
ALTER TABLE "ItemCategory" ADD CONSTRAINT "ItemCategory_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "ItemCategory"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CategoryProperty" ADD CONSTRAINT "CategoryProperty_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "ItemCategory"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ComponentPropertyValue" ADD CONSTRAINT "ComponentPropertyValue_componentId_fkey" FOREIGN KEY ("componentId") REFERENCES "Component"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ComponentPropertyValue" ADD CONSTRAINT "ComponentPropertyValue_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "CategoryProperty"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AlterTable
ALTER TABLE "Component" ADD COLUMN "categoryId" TEXT;

-- Data migration (#205): every distinct non-empty `Component.category` string
-- becomes a root category with no properties, per scope. Follows the #60
-- pattern: `md5(...)` gives deterministic ids so the shape of a re-run is
-- idempotent. Names are trimmed and compared case-sensitively — folding case
-- here would silently merge two categories a person deliberately kept apart,
-- and merging is a decision only they can make.

INSERT INTO "ItemCategory" ("id", "name", "parentId", "inheritProperties", "order", "scopeId", "createdAt", "updatedAt")
SELECT
    md5('itemcategory:' || COALESCE(s."scopeId", '') || ':' || s."name"),
    s."name",
    NULL,
    true,
    0,
    s."scopeId",
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
FROM (
    SELECT DISTINCT c."scopeId", trim(both from c."category") AS "name"
    FROM "Component" c
    WHERE c."category" IS NOT NULL AND trim(both from c."category") <> ''
) s;

UPDATE "Component" c
SET "categoryId" = ic."id"
FROM "ItemCategory" ic
WHERE ic."name" = trim(both from c."category")
  AND ic."scopeId" IS NOT DISTINCT FROM c."scopeId"
  AND c."category" IS NOT NULL
  AND trim(both from c."category") <> '';

-- DropColumn
ALTER TABLE "Component" DROP COLUMN "category";

-- CreateIndex
CREATE INDEX "Component_categoryId_idx" ON "Component"("categoryId");

-- AddForeignKey
ALTER TABLE "Component" ADD CONSTRAINT "Component_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "ItemCategory"("id") ON DELETE SET NULL ON UPDATE CASCADE;
