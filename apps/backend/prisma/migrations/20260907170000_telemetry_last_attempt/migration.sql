-- Pace retries by the last ATTEMPT, not the last success (#343).
--
-- `lastSentAt` only ever recorded a successful ping, and the daily schedule was
-- read from it — so an instance whose receiver was unreachable had nothing to
-- count from and re-tried on every hourly tick, forever. Backfilled from
-- `lastSentAt` so an instance that has been reporting happily does not treat
-- the upgrade as "never attempted" and send an extra ping on the next tick.
ALTER TABLE "TelemetrySettings" ADD COLUMN "lastAttemptAt" TIMESTAMP(3);

UPDATE "TelemetrySettings" SET "lastAttemptAt" = "lastSentAt" WHERE "lastSentAt" IS NOT NULL;
