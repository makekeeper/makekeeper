-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "lastTrackedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "TrackingEvent" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "location" TEXT,
    "eventTime" TIMESTAMP(3) NOT NULL,
    "raw" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TrackingEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LogisticsSettings" (
    "id" TEXT NOT NULL DEFAULT 'default',
    "trackingProvider" TEXT NOT NULL DEFAULT 'none',
    "trackingApiKey" TEXT,
    "autoTrackEnabled" BOOLEAN NOT NULL DEFAULT false,
    "pollIntervalHours" INTEGER NOT NULL DEFAULT 6,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LogisticsSettings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TrackingEvent_orderId_idx" ON "TrackingEvent"("orderId");

-- AddForeignKey
ALTER TABLE "TrackingEvent" ADD CONSTRAINT "TrackingEvent_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;
