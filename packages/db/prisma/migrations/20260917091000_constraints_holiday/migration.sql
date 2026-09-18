-- US-093 / BR-02: what a holiday row may hold (data-dictionary.md#holiday).
--
-- 1. Sundays are excluded by rule, never stored as holiday rows (M06). A
--    Sunday row would change nothing and would read as if it did.
-- 2. A holiday has a name: the Junior's route says "Today is a holiday: <name>".
--
-- "Future dates only" is not a constraint: it depends on today's business
-- date, which only the service knows (toBusinessDate). Existing rows were
-- checked before this migration: none falls on a Sunday or has a blank name.

ALTER TABLE "holiday"
  ADD CONSTRAINT "holiday_not_sunday_check"
  CHECK (EXTRACT(ISODOW FROM "date") <> 7);

ALTER TABLE "holiday"
  ADD CONSTRAINT "holiday_name_not_blank_check"
  CHECK (btrim("name") <> '');
