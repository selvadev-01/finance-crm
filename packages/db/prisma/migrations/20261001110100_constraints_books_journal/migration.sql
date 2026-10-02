-- Books slice 5 (ADR-0018) invariants. Specs in
-- apps/api/test/db-constraints/books-journal.spec.ts.

-- A journal says why it was needed.
ALTER TABLE "journal_entry"
  ADD CONSTRAINT "journal_entry_note_not_blank_check" CHECK (length(btrim("note")) > 0);

-- Append-only, like the ledger it explains: a wrong journal is answered by
-- another journal, never edited or removed.
CREATE TRIGGER "journal_entry_append_only" BEFORE UPDATE OR DELETE ON "journal_entry"
  FOR EACH ROW EXECUTE FUNCTION "books_entry_reject_mutation"();
