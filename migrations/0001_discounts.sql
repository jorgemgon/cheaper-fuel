-- Standardized discount objects.
-- There is deliberately no `status` column: activeness is derived from
-- valid_from / valid_until against "today" in Europe/Lisbon.
CREATE TABLE IF NOT EXISTS discounts (
  id                  TEXT PRIMARY KEY,
  schema_version      INTEGER NOT NULL DEFAULT 1,
  program_id          TEXT NOT NULL,
  program_title       TEXT NOT NULL,
  tier_id             TEXT,
  tier_label          TEXT,
  tier_rank           INTEGER NOT NULL DEFAULT 0,
  kind                TEXT NOT NULL,
  supplier            TEXT NOT NULL,
  partners_json       TEXT NOT NULL DEFAULT '[]',
  brands_json         TEXT NOT NULL DEFAULT '[]',
  name_prefixes_json  TEXT NOT NULL DEFAULT '[]',
  requires_json       TEXT NOT NULL DEFAULT '[]',
  min_services        INTEGER NOT NULL DEFAULT 0,
  channel             TEXT NOT NULL,
  value_type          TEXT,
  value               REAL,
  combine             TEXT NOT NULL DEFAULT 'sum',
  cap_litres_per_fill REAL,
  cap_litres_per_year REAL,
  valid_from          TEXT,
  valid_until         TEXT,
  confidence          TEXT NOT NULL,
  source_url          TEXT NOT NULL,
  source_retrieved_at TEXT NOT NULL,
  source_hash         TEXT,
  source_fetch_mode   TEXT NOT NULL DEFAULT 'auto',
  notes               TEXT,
  updated_at          TEXT NOT NULL,

  -- A programme may be tracked before its mechanic is quantified, but the
  -- value type and value must always agree with each other.
  CHECK (
    (value_type IS NULL AND value IS NULL) OR
    (value_type IS NOT NULL AND value > 0)
  ),
  CHECK (valid_from IS NULL OR valid_until IS NULL OR valid_from <= valid_until)
);

CREATE INDEX IF NOT EXISTS idx_discounts_group    ON discounts(program_id, tier_id);
CREATE INDEX IF NOT EXISTS idx_discounts_supplier ON discounts(supplier);
