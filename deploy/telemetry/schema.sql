-- The receiver's whole database (#343).
--
-- ONE ROW PER INSTANCE, never a log of pings. That is a deliberate limit, not a
-- simplification: with only a first and a last contact date, this table can
-- answer "how many instances survived a week" and cannot answer anything about
-- when or how anyone uses their workshop. A ping history would answer both, and
-- the second question is not ours to have.
CREATE TABLE IF NOT EXISTS instances (
  id             TEXT PRIMARY KEY,   -- the instance's own random uuid
  first_seen     TEXT NOT NULL,      -- ISO date of the first ping
  last_seen      TEXT NOT NULL,      -- ISO date of the most recent ping
  version        TEXT NOT NULL,
  install_method TEXT NOT NULL,
  plugins        TEXT NOT NULL,      -- comma-separated plugin ids
  locale         TEXT NOT NULL
);

-- Cohort queries scan by first_seen; the survival query below groups on it.
CREATE INDEX IF NOT EXISTS instances_first_seen ON instances (first_seen);
