-- Project groups (#285/#286): a folder tree for projects. Every project sits in
-- exactly one group, so `Project.groupId` is NOT NULL — which means this
-- migration must create one default ("General") group per existing scope and
-- point every project at it before the column can be tightened.

-- CreateTable
CREATE TABLE "ProjectGroup" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "parentId" TEXT,
    "position" INTEGER NOT NULL DEFAULT 0,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "scopeId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProjectGroup_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ProjectGroup_scopeId_idx" ON "ProjectGroup"("scopeId");

-- CreateIndex
CREATE INDEX "ProjectGroup_parentId_idx" ON "ProjectGroup"("parentId");

-- AddForeignKey
ALTER TABLE "ProjectGroup" ADD CONSTRAINT "ProjectGroup_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "ProjectGroup"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AlterTable
ALTER TABLE "Project" ADD COLUMN "groupId" TEXT;

-- Data migration: one General group per distinct scope present in Project,
-- NULL scope included. The id is `md5('projectgroup:default:' || scope)` — the
-- same derivation the backend uses for lazy creation, so a scope that already
-- got its group here is recognised rather than duplicated, and the primary key
-- is what closes the race between two concurrent first requests.
INSERT INTO "ProjectGroup" ("id", "name", "parentId", "position", "isDefault", "scopeId", "createdAt", "updatedAt")
SELECT
    md5('projectgroup:default:' || COALESCE(s."scopeId", '')),
    'General',
    NULL,
    0,
    true,
    s."scopeId",
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
FROM (SELECT DISTINCT p."scopeId" FROM "Project" p) s
ON CONFLICT ("id") DO NOTHING;

UPDATE "Project" p
SET "groupId" = md5('projectgroup:default:' || COALESCE(p."scopeId", ''));

-- Tighten only after the backfill.
ALTER TABLE "Project" ALTER COLUMN "groupId" SET NOT NULL;

-- CreateIndex
CREATE INDEX "Project_groupId_idx" ON "Project"("groupId");
