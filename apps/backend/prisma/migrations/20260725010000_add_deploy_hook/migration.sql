-- Admin-configured deploy hook for one-click update (#101). Lives on the existing
-- single-row update-checker settings — same instance-level concern.
-- URL and token are stored as ciphertext (SecretBoxService); the hook path can
-- itself be the credential, so it is encrypted like the token.
ALTER TABLE "UpdateCheckSettings" ADD COLUMN "deployHookUrl" TEXT;
ALTER TABLE "UpdateCheckSettings" ADD COLUMN "deployHookToken" TEXT;
ALTER TABLE "UpdateCheckSettings" ADD COLUMN "deployHookMethod" TEXT NOT NULL DEFAULT 'POST';
ALTER TABLE "UpdateCheckSettings" ADD COLUMN "hookTriggeredAt" TIMESTAMP(3);
ALTER TABLE "UpdateCheckSettings" ADD COLUMN "hookOutcome" TEXT NOT NULL DEFAULT 'never';
ALTER TABLE "UpdateCheckSettings" ADD COLUMN "hookStatusCode" INTEGER;
