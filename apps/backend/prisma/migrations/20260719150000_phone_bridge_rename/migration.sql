-- Generalize the phone-capture pairing into a phone-connection bridge (#77).
-- Pure renames + one added column with a default, so existing rows are preserved
-- (a live phone-capture session keeps working through the rename).

-- Attachment: the transient owner column is now bridge-generic.
ALTER TABLE "Attachment" RENAME COLUMN "captureSessionId" TO "bridgeSessionId";
ALTER INDEX "Attachment_captureSessionId_idx" RENAME TO "Attachment_bridgeSessionId_idx";

-- CaptureSession -> PhoneBridgeSession (+ kind selecting the phone surface).
ALTER TABLE "CaptureSession" RENAME TO "PhoneBridgeSession";
ALTER TABLE "PhoneBridgeSession" RENAME CONSTRAINT "CaptureSession_pkey" TO "PhoneBridgeSession_pkey";
ALTER INDEX "CaptureSession_expiresAt_idx" RENAME TO "PhoneBridgeSession_expiresAt_idx";
ALTER TABLE "PhoneBridgeSession" ADD COLUMN "kind" TEXT NOT NULL DEFAULT 'capture';

-- CaptureSettings -> PhoneBridgeSettings (singleton tunnel config).
ALTER TABLE "CaptureSettings" RENAME TO "PhoneBridgeSettings";
ALTER TABLE "PhoneBridgeSettings" RENAME CONSTRAINT "CaptureSettings_pkey" TO "PhoneBridgeSettings_pkey";
