-- One convention for a rule and its zone (#325): the rule's DTSTART holds the
-- wall clock and nothing else, and the zone lives in the row's own column.
--
-- Rules written before this carry `DTSTART;TZID=UTC:` — a filler the reminder
-- dialog emitted while the real zone sat in `timezone`. Left in place, the
-- reader now adopts that "UTC" and shifts every such schedule by its offset.
UPDATE "Schedule"
SET "rrule" = REPLACE("rrule", 'DTSTART;TZID=UTC:', 'DTSTART:')
WHERE "rrule" LIKE '%DTSTART;TZID=UTC:%';

UPDATE "PersonalSchedule"
SET "rrule" = REPLACE("rrule", 'DTSTART;TZID=UTC:', 'DTSTART:')
WHERE "rrule" LIKE '%DTSTART;TZID=UTC:%';
