-- Paired phones and the one-time codes that create them (#199). Credential
-- tables: only hashes are stored, and revocation is a timestamp so a lost
-- device is killed with one update.
CREATE TABLE "PairedDevice" (
    "id" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "userId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "PairedDevice_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PairedDevice_tokenHash_key" ON "PairedDevice"("tokenHash");
CREATE INDEX "PairedDevice_userId_idx" ON "PairedDevice"("userId");

CREATE TABLE "DevicePairingCode" (
    "id" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "userId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),

    CONSTRAINT "DevicePairingCode_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "DevicePairingCode_codeHash_key" ON "DevicePairingCode"("codeHash");
CREATE INDEX "DevicePairingCode_expiresAt_idx" ON "DevicePairingCode"("expiresAt");
