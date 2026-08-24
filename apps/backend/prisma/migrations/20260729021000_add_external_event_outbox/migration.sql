-- CreateTable
CREATE TABLE "ExternalEventDelivery" (
    "id" TEXT NOT NULL,
    "pluginId" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "eventScopeId" TEXT,
    "ref" TEXT,
    "diffJson" TEXT,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" TIMESTAMP(3),
    "deliveredAt" TIMESTAMP(3),
    "deadAt" TIMESTAMP(3),
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ExternalEventDelivery_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ExternalEventDelivery_pluginId_deliveredAt_idx" ON "ExternalEventDelivery"("pluginId", "deliveredAt");

-- CreateIndex
CREATE INDEX "ExternalEventDelivery_nextAttemptAt_idx" ON "ExternalEventDelivery"("nextAttemptAt");
