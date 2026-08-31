-- Bind a push subscription to the paired device it was created from (#311), so
-- revoking that device can stop its pushes. Nullable on purpose: a subscription
-- made from an ordinary browser session belongs to no device, and rows that
-- predate this column have no device to attribute them to either.

-- AlterTable
ALTER TABLE "PushSubscription" ADD COLUMN "deviceId" TEXT;

-- CreateIndex
CREATE INDEX "PushSubscription_deviceId_idx" ON "PushSubscription"("deviceId");
