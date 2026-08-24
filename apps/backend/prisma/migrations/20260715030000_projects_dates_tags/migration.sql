-- F0 (#42): projects gain their own scheduling (start/due dates) and freeform
-- tags. All nullable — additive and safe, no backfill required. Existing rows
-- keep NULLs; the derived-from-task deadline is replaced by Project.dueDate.
ALTER TABLE "Project" ADD COLUMN "startDate" TIMESTAMP(3);
ALTER TABLE "Project" ADD COLUMN "dueDate" TIMESTAMP(3);
ALTER TABLE "Project" ADD COLUMN "tags" TEXT;
