-- CreateTable
CREATE TABLE "ExternalPlugin" (
    "pluginId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "baseUrl" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "contractMajor" INTEGER NOT NULL,
    "contractMinor" INTEGER NOT NULL,
    "manifestJson" TEXT NOT NULL,
    "grantsJson" TEXT NOT NULL,
    "pendingJson" TEXT,
    "secretEnc" TEXT NOT NULL,
    "errorCode" TEXT,
    "boundScopeId" TEXT,
    "assistantEnabled" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ExternalPlugin_pkey" PRIMARY KEY ("pluginId")
);

-- CreateTable
CREATE TABLE "ExternalInstallToken" (
    "id" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedByPluginId" TEXT,

    CONSTRAINT "ExternalInstallToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExternalAccessToken" (
    "id" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "pluginId" TEXT NOT NULL,
    "class" TEXT NOT NULL,
    "userId" TEXT,
    "grantScopeId" TEXT,
    "expiresAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ExternalAccessToken_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ExternalInstallToken_tokenHash_key" ON "ExternalInstallToken"("tokenHash");

-- CreateIndex
CREATE UNIQUE INDEX "ExternalAccessToken_tokenHash_key" ON "ExternalAccessToken"("tokenHash");

-- CreateIndex
CREATE INDEX "ExternalAccessToken_pluginId_idx" ON "ExternalAccessToken"("pluginId");
