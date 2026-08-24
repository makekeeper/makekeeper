-- Mobile surface configuration: the published address and the test-mode flag
-- that makes a temporary Cloudflare tunnel count as installable. Singleton.
CREATE TABLE "MobileSettings" (
    "id" TEXT NOT NULL,
    "testMode" BOOLEAN NOT NULL DEFAULT false,
    "customOrigin" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MobileSettings_pkey" PRIMARY KEY ("id")
);
