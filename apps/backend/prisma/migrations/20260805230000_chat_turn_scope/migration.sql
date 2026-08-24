-- The project stops being an anchor of the conversation and becomes a property
-- of the turn (#130).
--
-- A session used to carry `projectId`, and that anchor was the bug: the panel
-- resolved it once, to the first project of the scope, and never moved. The
-- project now rides with the turn — stamped on the message it produced and on
-- the LLM call it paid for — so the same fact is recorded where it is decided.

ALTER TABLE "AIChatMessage" ADD COLUMN "projectId" TEXT;
ALTER TABLE "AIUsageEvent" ADD COLUMN "projectId" TEXT;

-- Backfill BEFORE the old column goes: every existing turn happened inside its
-- session's project, so that is its stamp. Both statements read
-- `AIChatSession."projectId"` — this is the only chance to.
UPDATE "AIChatMessage" m
SET "projectId" = s."projectId"
FROM "AIChatSession" s
WHERE m."sessionId" = s."id"
  AND s."projectId" IS NOT NULL;

-- Usage rows name their session, not their project — per-project spend was a
-- join through the session. Rows with no session (vision one-shots, and rows
-- written before the column existed) had no project attribution then and get
-- none now.
UPDATE "AIUsageEvent" u
SET "projectId" = s."projectId"
FROM "AIChatSession" s
WHERE u."sessionId" = s."id"
  AND s."projectId" IS NOT NULL;

CREATE INDEX "AIChatMessage_projectId_idx" ON "AIChatMessage"("projectId");
CREATE INDEX "AIUsageEvent_projectId_idx" ON "AIUsageEvent"("projectId");

-- The anchor itself. Dropping the column drops the FK with it, which also
-- removes the cascade that used to delete a whole conversation when its project
-- was deleted — deliberately: a chat is the user's own record of what they did,
-- and its turns keep naming a project that no longer exists exactly as an
-- accounting row does.
ALTER TABLE "AIChatSession" DROP COLUMN "projectId";
