-- Per-user JWT epoch: bumped on logout / admin password reset to invalidate
-- every token already issued for the user (#241).
ALTER TABLE "User" ADD COLUMN "tokenVersion" INTEGER NOT NULL DEFAULT 0;
