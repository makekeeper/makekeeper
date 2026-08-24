-- Instance update checker (#94). Single-row settings + last-check cache.
-- CreateTable
CREATE TABLE "UpdateCheckSettings" (
    "id" TEXT NOT NULL DEFAULT 'default',
    "autoCheckEnabled" BOOLEAN NOT NULL DEFAULT false,
    "checkHourUtc" INTEGER NOT NULL DEFAULT 3,
    "latestVersion" TEXT,
    "releaseUrl" TEXT,
    "lastCheckedAt" TIMESTAMP(3),
    "lastCheckStatus" TEXT NOT NULL DEFAULT 'never',
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UpdateCheckSettings_pkey" PRIMARY KEY ("id")
);
