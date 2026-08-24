-- Demote `datasheetUrl` from a first-class Component column to a regular entry
-- under `links` (#71). A datasheet is electronics jargon and not intrinsic to
-- every craft's inventory (yarn, timber have none), so the URL becomes just
-- another labelled link. Existing non-empty values are backfilled into the
-- `links` JSON array before the column is dropped — no data is lost.
--
-- `links` is TEXT holding either '' or a JSON array of { label, url } objects
-- (always written via JSON.stringify). The app upholds that invariant, but the
-- column has no CHECK constraint enforcing it, so we do NOT blindly cast the
-- existing value to jsonb — a single malformed row would abort the whole
-- migration and block deploy. Instead we append onto the existing array only
-- when it is valid JSON (`IS JSON ARRAY`, Postgres 16+), and otherwise start a
-- fresh array. Either way the datasheet URL is preserved; the cast can never
-- throw. The 'Datasheet' label mirrors the i18n key
-- `inventory.exchange.datasheetLinkLabel` used by the archive importer.

-- Backfill: append the datasheet as a labelled link.
UPDATE "Component"
SET "links" = (
  CASE
    WHEN NULLIF("links", '') IS NOT NULL AND "links" IS JSON ARRAY
      THEN "links"::jsonb
    ELSE '[]'::jsonb
  END
  || jsonb_build_array(
       jsonb_build_object('label', 'Datasheet', 'url', "datasheetUrl")
     )
)::text
WHERE "datasheetUrl" IS NOT NULL AND "datasheetUrl" <> '';

-- Drop the now-redundant column.
ALTER TABLE "Component" DROP COLUMN "datasheetUrl";
