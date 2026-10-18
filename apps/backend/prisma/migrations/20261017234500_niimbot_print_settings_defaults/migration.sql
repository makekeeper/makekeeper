-- Do not let a defaults-only carry-over pass for a configured printer (#366).
--
-- The previous migration copied the two values out of "NiimbotHaSettings"
-- unconditionally — but a row exists there for any instance that ever opened the
-- Home Assistant panel, usually holding nothing but the defaults. Copied across,
-- those defaults read as "this instance has print settings", which is exactly
-- what stops a browser from handing over the density and stock it remembers from
-- when they lived in the browser. A row indistinguishable from the defaults is
-- therefore removed: the carry-over fills it in, and an instance that genuinely
-- wanted 3 / gap labels lands on the same values either way.
DELETE FROM "NiimbotPrintSettings"
WHERE "density" = 3 AND "labelType" = 'withGaps';
