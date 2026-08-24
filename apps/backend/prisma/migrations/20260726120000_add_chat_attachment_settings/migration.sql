-- What may be attached to a chat message, per ruleset owner (#112).
--
-- Additive: no row means "no ruleset stored", and the service falls back to the
-- instance row and then to the code defaults, so an existing install keeps
-- working without a seed.
--
-- The primary key IS the owner ("instance", else the user id): a nullable
-- unique column would happily accept two instance rows, a primary key will not.

-- CreateTable
CREATE TABLE "ChatAttachmentSettings" (
    "id" TEXT NOT NULL,
    "ownerUserId" TEXT,
    "mimeTypes" TEXT NOT NULL,
    "extensions" TEXT NOT NULL,
    "maxNonImageBytes" INTEGER NOT NULL,
    "maxReadBytes" INTEGER NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ChatAttachmentSettings_pkey" PRIMARY KEY ("id")
);
