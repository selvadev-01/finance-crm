-- capital_entry invariants (US-032, M08). Specs in
-- apps/api/test/db-constraints/capital-entry.spec.ts.

-- ---------------------------------------------------------------------------
-- 1. Money in is positive, and says where it came from. The ledger line
--    carries only the amount; the note is the only record of the source.
-- ---------------------------------------------------------------------------

ALTER TABLE "capital_entry"
  ADD CONSTRAINT "capital_entry_amount_positive_check"
    CHECK ("amount" > 0),
  ADD CONSTRAINT "capital_entry_note_not_blank_check"
    CHECK (length(btrim("note")) > 0);

-- ---------------------------------------------------------------------------
-- 2. Append-only, like the ledger transaction it is the source of: a mistake
--    is answered by a later entry, never by changing this one.
-- ---------------------------------------------------------------------------

CREATE FUNCTION "capital_entry_reject_mutation"()
RETURNS trigger
LANGUAGE plpgsql
SET search_path FROM CURRENT
AS $$
BEGIN
  RAISE EXCEPTION
    'capital_entry_append_only: % on capital_entry is not permitted',
    TG_OP;
END;
$$;

CREATE TRIGGER "capital_entry_append_only"
  BEFORE UPDATE OR DELETE ON "capital_entry"
  FOR EACH ROW
  EXECUTE FUNCTION "capital_entry_reject_mutation"();
