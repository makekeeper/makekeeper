-- F1 (#43): manual ordering of projects within a kanban status column.
-- NOT NULL with a default of 0 — existing rows collapse to 0 and fall back to
-- createdAt ordering until a drag assigns explicit positions. Additive/safe.
ALTER TABLE "Project" ADD COLUMN "position" INTEGER NOT NULL DEFAULT 0;
