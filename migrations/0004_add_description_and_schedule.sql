-- Adds a required human-readable description and the day-of-week /
-- day-of-month schedule. Existing rows get safe defaults; the following seed
-- migration backfills the real values.
ALTER TABLE discounts ADD COLUMN description TEXT NOT NULL DEFAULT '';
ALTER TABLE discounts ADD COLUMN schedule_kind TEXT NOT NULL DEFAULT 'always';
ALTER TABLE discounts ADD COLUMN schedule_weekdays_json TEXT NOT NULL DEFAULT '[]';
ALTER TABLE discounts ADD COLUMN schedule_days_of_month_json TEXT NOT NULL DEFAULT '[]';
ALTER TABLE discounts ADD COLUMN schedule_nth INTEGER;
ALTER TABLE discounts ADD COLUMN schedule_weekday INTEGER;
