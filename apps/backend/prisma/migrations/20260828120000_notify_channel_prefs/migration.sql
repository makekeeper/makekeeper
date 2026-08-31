-- A person's master switch per channel (#311): distinct from the per-type
-- routing matrix, which decides what goes there once the channel is in use.

-- CreateTable
CREATE TABLE "NotifyChannelPref" (
    "id" TEXT NOT NULL,
    "scopeId" TEXT,
    "channelId" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NotifyChannelPref_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "NotifyChannelPref_scopeId_channelId_key" ON "NotifyChannelPref"("scopeId", "channelId");
CREATE INDEX "NotifyChannelPref_scopeId_idx" ON "NotifyChannelPref"("scopeId");
