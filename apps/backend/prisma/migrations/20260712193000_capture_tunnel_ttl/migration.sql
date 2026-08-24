-- Keep an auto tunnel up this long (minutes) after its last use.
ALTER TABLE "CaptureSettings" ADD COLUMN "tunnelIdleTtlMinutes" INTEGER NOT NULL DEFAULT 5;
