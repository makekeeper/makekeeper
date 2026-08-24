-- Finish the re-home: a file belongs to its parent, whatever else it carries (#125).
--
-- `20260727181000` re-homed only rows with `sessionId IS NULL`, on the reading
-- that "attachment of a chat" meant private. That reading was wrong: a chat is a
-- conversation, not something a file becomes part of. A picture sent in a chat
-- while a project is open IS a project file — chat.service stamps its
-- `projectId` for exactly that reason (#109/#112), and it belongs in that
-- project's Files tab for everyone the project is shared with. Only a file with
-- no parent at all stays private to whoever uploaded it.
--
-- So the condition on `sessionId` is dropped and the whole rule restated. The
-- statements are idempotent: rows the earlier pass already moved match nothing
-- (`IS DISTINCT FROM` filters them out).
UPDATE "Attachment" a
SET "scopeId" = p."scopeId"
FROM "Project" p
WHERE a."projectId" = p.id
  AND p."scopeId" IS NOT NULL
  AND a."scopeId" IS DISTINCT FROM p."scopeId";

-- A component photo follows its component. Applied after the project pass so a
-- row carrying both lands on the same owner either way (component and project
-- live in one scope); the project is the broader parent and wins the on-disk
-- filing, but for OWNERSHIP the two agree by construction.
UPDATE "Attachment" a
SET "scopeId" = c."scopeId"
FROM "Component" c
WHERE a."componentId" = c.id
  AND a."projectId" IS NULL
  AND c."scopeId" IS NOT NULL
  AND a."scopeId" IS DISTINCT FROM c."scopeId";
