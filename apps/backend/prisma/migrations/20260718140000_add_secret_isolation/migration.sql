-- Per-user secret isolation (#63): DEK keyring, session re-arm tokens, and the
-- out-of-session secret-access audit. Existing plaintext secrets (provider API
-- keys, tracking API keys) are encrypted in place by a one-time startup
-- migration in application code, not here.

-- CreateTable
CREATE TABLE "UserKeyring" (
    "userId" TEXT NOT NULL,
    "wrappedDekPassword" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserKeyring_pkey" PRIMARY KEY ("userId")
);

-- CreateTable
CREATE TABLE "KeySession" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "wrappedDekSession" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "KeySession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SecretAccessLog" (
    "id" TEXT NOT NULL,
    "ownerUserId" TEXT NOT NULL,
    "actorUserId" TEXT,
    "pluginId" TEXT NOT NULL,
    "purposeKey" TEXT NOT NULL,
    "byGuest" BOOLEAN NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SecretAccessLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "KeySession_userId_idx" ON "KeySession"("userId");

-- CreateIndex
CREATE INDEX "KeySession_expiresAt_idx" ON "KeySession"("expiresAt");

-- CreateIndex
CREATE INDEX "SecretAccessLog_ownerUserId_createdAt_idx" ON "SecretAccessLog"("ownerUserId", "createdAt");
