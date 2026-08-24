-- Re-home attachments that belong to a scope onto that scope (#125).
--
-- Attachments used to be user-bound: the row was stamped with whoever uploaded
-- it, whatever scope they were browsing. Now a project file and a component
-- photo follow their parent, so a file a grantee added to a shared project must
-- stop being filed under the grantee — otherwise the scope owner cannot see a
-- file inside their own project.
--
-- Chat attachments (`sessionId` set) are deliberately untouched: those stay
-- private to their author. Phone-bridge uploads are transient and belong to
-- their session, not to a scope.
UPDATE "Attachment" a
SET "scopeId" = p."scopeId"
FROM "Project" p
WHERE a."projectId" = p.id
  AND a."sessionId" IS NULL
  AND p."scopeId" IS NOT NULL
  AND a."scopeId" IS DISTINCT FROM p."scopeId";

UPDATE "Attachment" a
SET "scopeId" = c."scopeId"
FROM "Component" c
WHERE a."componentId" = c.id
  AND a."sessionId" IS NULL
  AND c."scopeId" IS NOT NULL
  AND a."scopeId" IS DISTINCT FROM c."scopeId";
