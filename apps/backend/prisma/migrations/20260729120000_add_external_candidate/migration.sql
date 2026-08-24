-- CreateTable
CREATE TABLE "ExternalCandidate" (
    "id" TEXT NOT NULL,
    "pluginId" TEXT NOT NULL,
    "baseUrl" TEXT NOT NULL,
    "manifestJson" TEXT NOT NULL,
    "announceKeyHash" TEXT NOT NULL,
    "pairingCodeHash" TEXT NOT NULL,
    "sourceIp" TEXT,
    "pairedAt" TIMESTAMP(3),
    "issuedSecretEnc" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ExternalCandidate_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ExternalCandidate_pluginId_idx" ON "ExternalCandidate"("pluginId");

-- CreateIndex
CREATE INDEX "ExternalCandidate_expiresAt_idx" ON "ExternalCandidate"("expiresAt");
