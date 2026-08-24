-- AlterTable: session title + pin for the project AI-history list
ALTER TABLE "AIChatSession" ADD COLUMN "title" TEXT;
ALTER TABLE "AIChatSession" ADD COLUMN "pinned" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable: attribute usage rows to their chat session (no FK — rows outlive the session)
ALTER TABLE "AIUsageEvent" ADD COLUMN "sessionId" TEXT;

-- CreateIndex
CREATE INDEX "AIUsageEvent_sessionId_idx" ON "AIUsageEvent"("sessionId");
