-- A connection labels its outgoing LLM requests so the operator of an LLM proxy
-- recognises them in the log and accounts for them separately (#231, epic #230).
--
-- Three nullable columns and deliberately no backfill: an existing connection
-- has never sent a label, and an upgrade must not make it start. NULL
-- `proxyLabelSegments` is read as "label" alone — the other segments carry the
-- user's own domain data to a third party and stay opt-in.

ALTER TABLE "AIProviderConfig" ADD COLUMN "proxyLabel" TEXT;
ALTER TABLE "AIProviderConfig" ADD COLUMN "proxyLabelSegments" TEXT;
ALTER TABLE "AIProviderConfig" ADD COLUMN "proxyHeaderName" TEXT;
