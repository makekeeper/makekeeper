-- "Let us know you're here" (#367). A singleton settings row, created lazily by
-- the service on the first read: `firstSeenAt` then dates the instance's week
-- from the update that brought the feature. No default row is inserted here on
-- purpose — an instance that never renders the shell carries no state for it.
CREATE TABLE "HelloNudgeSettings" (
    "id" TEXT NOT NULL DEFAULT 'default',
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "dismissedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HelloNudgeSettings_pkey" PRIMARY KEY ("id")
);
