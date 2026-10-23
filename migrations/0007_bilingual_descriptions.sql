-- Bilingual discount descriptions.
-- The existing column holds English, so rename it and add Portuguese.
-- The following generated seed migration backfills both columns.
ALTER TABLE discounts RENAME COLUMN description TO description_en;
ALTER TABLE discounts ADD COLUMN description_pt TEXT NOT NULL DEFAULT '';
