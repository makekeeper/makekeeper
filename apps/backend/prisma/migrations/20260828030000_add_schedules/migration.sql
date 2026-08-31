-- Schedules (#306/#308): a moment makes something happen.
-- Two schedule tables, not one with a privacy flag: the multiuser overlay
-- confines a model one way for all its rows, so a personal reminder's privacy
-- must be structural rather than a `where` clause somebody can forget.

-- CreateTable
CREATE TABLE "Schedule" (
    "id" TEXT NOT NULL,
    "scopeId" TEXT,
    "ownerUserId" TEXT,
    "hookId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "triggerKind" TEXT NOT NULL,
    "rrule" TEXT,
    "timezone" TEXT,
    "ref" TEXT,
    "refField" TEXT,
    "offsetMinutes" INTEGER,
    "paramsJson" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "nextRunAt" TIMESTAMP(3),
    "lastRunAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Schedule_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Schedule_scopeId_idx" ON "Schedule"("scopeId");
CREATE INDEX "Schedule_enabled_nextRunAt_idx" ON "Schedule"("enabled", "nextRunAt");

-- CreateTable
CREATE TABLE "PersonalSchedule" (
    "id" TEXT NOT NULL,
    "scopeId" TEXT,
    "ownerUserId" TEXT,
    "hookId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "triggerKind" TEXT NOT NULL,
    "rrule" TEXT,
    "timezone" TEXT,
    "ref" TEXT,
    "refField" TEXT,
    "offsetMinutes" INTEGER,
    "paramsJson" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "nextRunAt" TIMESTAMP(3),
    "lastRunAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PersonalSchedule_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PersonalSchedule_scopeId_idx" ON "PersonalSchedule"("scopeId");
CREATE INDEX "PersonalSchedule_enabled_nextRunAt_idx" ON "PersonalSchedule"("enabled", "nextRunAt");

-- CreateTable
CREATE TABLE "ScheduleRun" (
    "id" TEXT NOT NULL,
    "scopeId" TEXT,
    "scheduleId" TEXT NOT NULL,
    "personal" BOOLEAN NOT NULL DEFAULT false,
    "hookId" TEXT NOT NULL,
    "dueAt" TIMESTAMP(3) NOT NULL,
    "ranAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "occurrences" INTEGER NOT NULL DEFAULT 1,
    "outcome" TEXT NOT NULL,
    "detail" TEXT,

    CONSTRAINT "ScheduleRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ScheduleRun_scopeId_ranAt_idx" ON "ScheduleRun"("scopeId", "ranAt");
CREATE INDEX "ScheduleRun_scheduleId_idx" ON "ScheduleRun"("scheduleId");
