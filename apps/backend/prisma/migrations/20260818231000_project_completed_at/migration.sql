-- #294: when a project actually reached the closed status.
--
-- Deliberately NOT backfilled. `ActivityEvent` records `status_changed` without
-- the target status, so any backfill would harden a guess into a stored fact —
-- and the timeline can no longer tell a derived edge from a stated one. Existing
-- closed rows stay NULL and heal on their next close; until then the timeline
-- falls back to dueDate, then updatedAt, and marks the edge as inferred.
ALTER TABLE "Project" ADD COLUMN "completedAt" TIMESTAMP(3);
