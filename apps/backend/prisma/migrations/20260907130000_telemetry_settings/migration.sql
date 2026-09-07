-- Opt-in liveness telemetry (#343). A singleton settings row, created lazily by
-- the service; the default row is NOT inserted here on purpose — "no row" and
-- "row saying unasked" mean the same thing, and an install that never opens the
-- dialog should carry no telemetry state at all.
CREATE TABLE "TelemetrySettings" (
    "id" TEXT NOT NULL DEFAULT 'default',
    "consent" TEXT NOT NULL DEFAULT 'unasked',
    "instanceId" TEXT,
    "locale" TEXT,
    "promptedAt" TIMESTAMP(3),
    "decidedAt" TIMESTAMP(3),
    "lastSentAt" TIMESTAMP(3),
    "lastStatus" TEXT NOT NULL DEFAULT 'never',
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TelemetrySettings_pkey" PRIMARY KEY ("id")
);
