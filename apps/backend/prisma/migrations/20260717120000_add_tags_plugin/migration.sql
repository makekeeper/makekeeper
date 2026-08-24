-- CreateTable
CREATE TABLE "Tag" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "color" TEXT NOT NULL DEFAULT 'slate',
    "scopeId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Tag_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TagLink" (
    "id" TEXT NOT NULL,
    "tagId" TEXT NOT NULL,
    "ref" TEXT NOT NULL,
    "scopeId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TagLink_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Tag_scopeId_idx" ON "Tag"("scopeId");

-- CreateIndex
CREATE UNIQUE INDEX "Tag_scopeId_name_key" ON "Tag"("scopeId", "name");

-- CreateIndex
CREATE INDEX "TagLink_ref_idx" ON "TagLink"("ref");

-- CreateIndex
CREATE INDEX "TagLink_scopeId_idx" ON "TagLink"("scopeId");

-- CreateIndex
CREATE UNIQUE INDEX "TagLink_tagId_ref_key" ON "TagLink"("tagId", "ref");

-- AddForeignKey
ALTER TABLE "TagLink" ADD CONSTRAINT "TagLink_tagId_fkey" FOREIGN KEY ("tagId") REFERENCES "Tag"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Data migration (#60): fold the legacy freeform `Project.tags` JSON array into
-- the managed Tag/TagLink vocabulary, then drop the column. Runs inside the
-- single migration transaction, so the copy and the drop are atomic.
--
-- `md5(...)` yields deterministic ids so re-runs would be idempotent in shape.
-- The `ref` is built by string concatenation rather than formatObjectRef()
-- (unavailable in SQL): project ids are app-generated UUIDs with no '/','#' or
-- '%', so the concatenation is byte-identical to the helper's canonical output.
-- `p."tags" LIKE '[%'` skips NULL/empty/non-array values before the ::json cast.

INSERT INTO "Tag" ("id", "name", "color", "scopeId", "createdAt", "updatedAt")
SELECT
    md5('tag:' || COALESCE(s."scopeId", '') || ':' || s."name"),
    s."name",
    'slate',
    s."scopeId",
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
FROM (
    SELECT DISTINCT p."scopeId", trim(both from v.value) AS "name"
    FROM "Project" p
    CROSS JOIN LATERAL json_array_elements_text(p."tags"::json) v(value)
    WHERE p."tags" LIKE '[%' AND trim(both from v.value) <> ''
) s;

INSERT INTO "TagLink" ("id", "tagId", "ref", "scopeId", "createdAt")
SELECT
    md5('taglink:' || p."id" || ':' || t."id"),
    t."id",
    'diy://projects/project/' || p."id",
    p."scopeId",
    CURRENT_TIMESTAMP
FROM "Project" p
CROSS JOIN LATERAL json_array_elements_text(p."tags"::json) v(value)
JOIN "Tag" t
    ON t."name" = trim(both from v.value)
   AND t."scopeId" IS NOT DISTINCT FROM p."scopeId"
WHERE p."tags" LIKE '[%' AND trim(both from v.value) <> '';

-- DropColumn
ALTER TABLE "Project" DROP COLUMN "tags";
