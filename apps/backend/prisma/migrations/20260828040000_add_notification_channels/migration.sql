-- Notification channels (#306/#311): routing, action tokens and web push.

-- CreateTable
CREATE TABLE "NotificationRoute" (
    "id" TEXT NOT NULL,
    "scopeId" TEXT,
    "type" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NotificationRoute_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "NotificationRoute_scopeId_type_channelId_key" ON "NotificationRoute"("scopeId", "type", "channelId");
CREATE INDEX "NotificationRoute_scopeId_idx" ON "NotificationRoute"("scopeId");

-- CreateTable
CREATE TABLE "NotificationActionToken" (
    "token" TEXT NOT NULL,
    "notificationId" TEXT NOT NULL,
    "scopeId" TEXT,
    "kind" TEXT NOT NULL,
    "hookId" TEXT,
    "channelId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NotificationActionToken_pkey" PRIMARY KEY ("token")
);

-- CreateIndex
CREATE INDEX "NotificationActionToken_notificationId_idx" ON "NotificationActionToken"("notificationId");
CREATE INDEX "NotificationActionToken_expiresAt_idx" ON "NotificationActionToken"("expiresAt");

-- CreateTable
CREATE TABLE "PushSubscription" (
    "id" TEXT NOT NULL,
    "scopeId" TEXT,
    "endpoint" TEXT NOT NULL,
    "p256dh" TEXT NOT NULL,
    "auth" TEXT NOT NULL,
    "label" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUsedAt" TIMESTAMP(3),

    CONSTRAINT "PushSubscription_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PushSubscription_endpoint_key" ON "PushSubscription"("endpoint");
CREATE INDEX "PushSubscription_scopeId_idx" ON "PushSubscription"("scopeId");

-- CreateTable
CREATE TABLE "PushSettings" (
    "id" TEXT NOT NULL DEFAULT 'default',
    "publicKey" TEXT NOT NULL,
    "privateKeyEnc" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PushSettings_pkey" PRIMARY KEY ("id")
);

-- The reader's language, so a channel message is built in it rather than in
-- whatever the poster happened to be using.
ALTER TABLE "NotifyPreference" ADD COLUMN "locale" TEXT;
