-- Notifications (#306/#307): the bus, the inbox and its delivery attempts.
-- Nothing is backfilled — a notification is a thing that happened to somebody,
-- and inventing past ones would put unread rows in front of people about facts
-- they already dealt with.

-- CreateTable
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL,
    "scopeId" TEXT,
    "type" TEXT NOT NULL,
    "pluginId" TEXT NOT NULL,
    "titleKey" TEXT NOT NULL,
    "bodyKey" TEXT,
    "paramsJson" TEXT,
    "ref" TEXT,
    "importance" TEXT NOT NULL DEFAULT 'normal',
    "actionsJson" TEXT,
    "dedupKey" TEXT,
    "occurrences" INTEGER NOT NULL DEFAULT 1,
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Notification_scopeId_readAt_idx" ON "Notification"("scopeId", "readAt");
CREATE INDEX "Notification_scopeId_pluginId_readAt_idx" ON "Notification"("scopeId", "pluginId", "readAt");
CREATE INDEX "Notification_scopeId_dedupKey_idx" ON "Notification"("scopeId", "dedupKey");

-- CreateTable
CREATE TABLE "NotificationDelivery" (
    "id" TEXT NOT NULL,
    "notificationId" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" TIMESTAMP(3),
    "deliveredAt" TIMESTAMP(3),
    "deadAt" TIMESTAMP(3),
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NotificationDelivery_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "NotificationDelivery_notificationId_idx" ON "NotificationDelivery"("notificationId");
CREATE INDEX "NotificationDelivery_nextAttemptAt_idx" ON "NotificationDelivery"("nextAttemptAt");

-- AddForeignKey
ALTER TABLE "NotificationDelivery" ADD CONSTRAINT "NotificationDelivery_notificationId_fkey" FOREIGN KEY ("notificationId") REFERENCES "Notification"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateTable
CREATE TABLE "NotificationTypeConfig" (
    "type" TEXT NOT NULL,
    "pluginId" TEXT NOT NULL,
    "importance" TEXT NOT NULL,
    "allowedJson" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NotificationTypeConfig_pkey" PRIMARY KEY ("type")
);

-- CreateTable
CREATE TABLE "NotifyPreference" (
    "id" TEXT NOT NULL,
    "scopeId" TEXT,
    "quietFromMinutes" INTEGER,
    "quietToMinutes" INTEGER,
    "timezone" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NotifyPreference_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "NotifyPreference_scopeId_idx" ON "NotifyPreference"("scopeId");
