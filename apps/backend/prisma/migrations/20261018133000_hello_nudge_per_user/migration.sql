-- The say-hello card is closed per PERSON, not per instance (#368). The
-- instance keeps only its own date; the close moves to a user-bound row.
-- `dismissedAt` on the settings row is dropped rather than migrated: #367 was
-- never released, so no instance outside development has a value to keep.
ALTER TABLE "HelloNudgeSettings" DROP COLUMN "dismissedAt";

CREATE TABLE "HelloNudgeDismissal" (
    "id" TEXT NOT NULL,
    "scopeId" TEXT,
    "dismissedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HelloNudgeDismissal_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "HelloNudgeDismissal_scopeId_idx" ON "HelloNudgeDismissal"("scopeId");
