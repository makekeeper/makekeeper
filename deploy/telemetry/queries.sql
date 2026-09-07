-- What the receiver is for: the two numbers epic #336 is judged by.
--
-- Read them with:
--   npx wrangler d1 execute makekeeper-telemetry --remote --file deploy/telemetry/queries.sql

-- Survival by install week. `installs` is how many instances first reported in
-- that week; `alive_7`/`alive_30` how many of them were still reporting a week
-- and a month later.
--
-- A cohort younger than the window is NOT yet answerable — an instance
-- installed three days ago cannot have survived seven — so the last row or two
-- always read low. Read them as incomplete, not as a decline.
SELECT
  strftime('%Y-W%W', first_seen)                              AS cohort,
  COUNT(*)                                                    AS installs,
  SUM(julianday(last_seen) - julianday(first_seen) >= 7)      AS alive_7,
  SUM(julianday(last_seen) - julianday(first_seen) >= 30)     AS alive_30
FROM instances
GROUP BY cohort
ORDER BY cohort;

-- Which deployment paths people actually use — the question #102 originally
-- asked. Biased twice over (older installs report "unknown", and only those who
-- agreed are here at all), so it ranks paths, it does not measure them.
SELECT install_method, COUNT(*) AS instances
FROM instances
GROUP BY install_method
ORDER BY instances DESC;

-- Still reporting in the last week.
SELECT COUNT(*) AS active_7d
FROM instances
WHERE julianday('now') - julianday(last_seen) <= 7;
