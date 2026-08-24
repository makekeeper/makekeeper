-- AlterTable
ALTER TABLE "AIChatSession" ADD COLUMN     "scopeId" TEXT;

-- AlterTable
ALTER TABLE "Attachment" ADD COLUMN     "scopeId" TEXT;

-- AlterTable
ALTER TABLE "Component" ADD COLUMN     "scopeId" TEXT;

-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "scopeId" TEXT;

-- AlterTable
ALTER TABLE "Project" ADD COLUMN     "scopeId" TEXT;

-- AlterTable
ALTER TABLE "StockMovement" ADD COLUMN     "scopeId" TEXT;

-- AlterTable
ALTER TABLE "Storage" ADD COLUMN     "scopeId" TEXT;

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "displayName" TEXT,
    "isAdmin" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScopeGrant" (
    "id" TEXT NOT NULL,
    "ownerUserId" TEXT NOT NULL,
    "granteeUserId" TEXT NOT NULL,
    "accessLevel" TEXT NOT NULL,
    "allowedPluginIds" TEXT NOT NULL,
    "resourceRestrictions" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ScopeGrant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserPluginConfig" (
    "userId" TEXT NOT NULL,
    "pluginId" TEXT NOT NULL,
    "isEnabled" BOOLEAN NOT NULL DEFAULT true,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserPluginConfig_pkey" PRIMARY KEY ("userId","pluginId")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_username_key" ON "User"("username");

-- CreateIndex
CREATE INDEX "ScopeGrant_granteeUserId_idx" ON "ScopeGrant"("granteeUserId");

-- CreateIndex
CREATE UNIQUE INDEX "ScopeGrant_ownerUserId_granteeUserId_key" ON "ScopeGrant"("ownerUserId", "granteeUserId");

-- CreateIndex
CREATE INDEX "AIChatSession_scopeId_idx" ON "AIChatSession"("scopeId");

-- CreateIndex
CREATE INDEX "Attachment_scopeId_idx" ON "Attachment"("scopeId");

-- CreateIndex
CREATE INDEX "Component_scopeId_idx" ON "Component"("scopeId");

-- CreateIndex
CREATE INDEX "Order_scopeId_idx" ON "Order"("scopeId");

-- CreateIndex
CREATE INDEX "Project_scopeId_idx" ON "Project"("scopeId");

-- CreateIndex
CREATE INDEX "StockMovement_scopeId_idx" ON "StockMovement"("scopeId");

-- CreateIndex
CREATE INDEX "Storage_scopeId_idx" ON "Storage"("scopeId");
