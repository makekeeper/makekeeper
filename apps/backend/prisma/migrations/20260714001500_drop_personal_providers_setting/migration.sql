-- Personal AI connections are now always available in multi-user mode — the
-- admin kill-switch was dropped (users without a shared connection have no
-- alternative to their own credentials anyway).
ALTER TABLE "MultiuserSettings" DROP COLUMN "allowPersonalProviders";

-- Personal connections are always private; collapse any legacy sharing level.
UPDATE "AIProviderConfig" SET "sharedWith" = 'none' WHERE "sharedWith" NOT IN ('none', 'everyone');
