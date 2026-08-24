-- CreateTable
CREATE TABLE "AIUsageEvent" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "providerName" TEXT,
    "modelName" TEXT NOT NULL,
    "promptTokens" INTEGER,
    "completionTokens" INTEGER,
    "totalTokens" INTEGER,
    "isError" BOOLEAN NOT NULL DEFAULT false,
    "scopeId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AIUsageEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AIUsageEvent_scopeId_idx" ON "AIUsageEvent"("scopeId");

-- CreateIndex
CREATE INDEX "AIUsageEvent_createdAt_idx" ON "AIUsageEvent"("createdAt");
