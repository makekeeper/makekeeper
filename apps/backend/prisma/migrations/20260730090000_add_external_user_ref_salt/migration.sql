-- Opaque per-plugin user references (#156).
-- Additive and nullable: existing rows get their salt on first use, so no
-- backfill and nothing is rewritten.
ALTER TABLE "ExternalPlugin" ADD COLUMN "userRefSalt" TEXT;
