-- Retire the legacy `diy://` ORef scheme (#80). The MakeKeeper rename made `mk://`
-- the only recognized scheme; `parseObjectRef` no longer accepts `diy://`, so any
-- ref persisted with the old scheme by an earlier migration (e.g. the tags backfill
-- in 20260717120000) must be rewritten in place or it would stop resolving.
-- Forward-only and idempotent: rewrites only the scheme prefix, leaving the
-- pluginId/type/id/fragment untouched.

UPDATE "TagLink"
SET "ref" = 'mk://' || substring("ref" FROM 7)
WHERE "ref" LIKE 'diy://%';

UPDATE "Label"
SET "ref" = 'mk://' || substring("ref" FROM 7)
WHERE "ref" LIKE 'diy://%';
