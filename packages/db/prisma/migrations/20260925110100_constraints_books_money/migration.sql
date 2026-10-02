-- Books slice 2 (ADR-0018) invariants. Specs in
-- apps/api/test/db-constraints/books-money.spec.ts.

-- ---------------------------------------------------------------------------
-- 1. Amounts are positive and every entry says what it was for.
-- ---------------------------------------------------------------------------

ALTER TABLE "expense"
  ADD CONSTRAINT "expense_amount_positive_check" CHECK ("amount" > 0),
  ADD CONSTRAINT "expense_note_not_blank_check" CHECK (length(btrim("note")) > 0);
ALTER TABLE "bank_transfer"
  ADD CONSTRAINT "bank_transfer_amount_positive_check" CHECK ("amount" > 0),
  ADD CONSTRAINT "bank_transfer_note_not_blank_check" CHECK (length(btrim("note")) > 0);
ALTER TABLE "drawing_entry"
  ADD CONSTRAINT "drawing_entry_amount_positive_check" CHECK ("amount" > 0),
  ADD CONSTRAINT "drawing_entry_note_not_blank_check" CHECK (length(btrim("note")) > 0);
ALTER TABLE "income_entry"
  ADD CONSTRAINT "income_entry_amount_positive_check" CHECK ("amount" > 0),
  ADD CONSTRAINT "income_entry_note_not_blank_check" CHECK (length(btrim("note")) > 0);

-- ---------------------------------------------------------------------------
-- 2. An expense's shape follows where it was paid from:
--    - a bank only when paid from a bank;
--    - a spender and a line only for a field expense, and then both;
--    - an office or bank expense is recorded already approved;
--    - decided exactly when no longer pending;
--    - nobody approves or rejects money they spent themselves.
-- ---------------------------------------------------------------------------

ALTER TABLE "expense"
  ADD CONSTRAINT "expense_bank_check"
    CHECK (("paidFrom" = 'BANK') = ("bankAccountId" IS NOT NULL)),
  ADD CONSTRAINT "expense_field_check"
    CHECK (
      ("paidFrom" = 'CASH_IN_HAND') = ("spenderUserId" IS NOT NULL)
      AND ("paidFrom" = 'CASH_IN_HAND') = ("lineId" IS NOT NULL)
    ),
  ADD CONSTRAINT "expense_office_approved_check"
    CHECK ("paidFrom" = 'CASH_IN_HAND' OR "status" = 'APPROVED'),
  ADD CONSTRAINT "expense_decided_check"
    CHECK (("status" = 'PENDING') = ("decidedAt" IS NULL)
       AND ("decidedAt" IS NULL) = ("decidedByUserId" IS NULL)),
  ADD CONSTRAINT "expense_not_self_decided_check"
    CHECK ("spenderUserId" IS NULL OR "decidedByUserId" IS DISTINCT FROM "spenderUserId");

-- ---------------------------------------------------------------------------
-- 3. An expense is never deleted, and never changed except its one decision:
--    PENDING to APPROVED or REJECTED, with who, when and a note.
-- ---------------------------------------------------------------------------

CREATE FUNCTION "expense_guard"()
RETURNS trigger
LANGUAGE plpgsql
SET search_path FROM CURRENT
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'expense_guard: an expense is never deleted';
  END IF;
  IF NEW."organizationId" IS DISTINCT FROM OLD."organizationId"
     OR NEW."expenseCategoryId" IS DISTINCT FROM OLD."expenseCategoryId"
     OR NEW."amount" IS DISTINCT FROM OLD."amount"
     OR NEW."businessDate" IS DISTINCT FROM OLD."businessDate"
     OR NEW."note" IS DISTINCT FROM OLD."note"
     OR NEW."paidFrom" IS DISTINCT FROM OLD."paidFrom"
     OR NEW."bankAccountId" IS DISTINCT FROM OLD."bankAccountId"
     OR NEW."spenderUserId" IS DISTINCT FROM OLD."spenderUserId"
     OR NEW."lineId" IS DISTINCT FROM OLD."lineId"
     OR NEW."createdByUserId" IS DISTINCT FROM OLD."createdByUserId" THEN
    RAISE EXCEPTION 'expense_guard: an expense''s money and source never change';
  END IF;
  IF NEW."status" IS DISTINCT FROM OLD."status"
     AND NOT (OLD."status" = 'PENDING' AND NEW."status" IN ('APPROVED', 'REJECTED')) THEN
    RAISE EXCEPTION 'expense_guard: an expense is decided once, from PENDING';
  END IF;
  IF OLD."status" <> 'PENDING' AND (
       NEW."decidedByUserId" IS DISTINCT FROM OLD."decidedByUserId"
    OR NEW."decidedAt" IS DISTINCT FROM OLD."decidedAt"
    OR NEW."decisionNote" IS DISTINCT FROM OLD."decisionNote") THEN
    RAISE EXCEPTION 'expense_guard: a decision is never changed';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "expense_guard"
  BEFORE UPDATE OR DELETE ON "expense"
  FOR EACH ROW
  EXECUTE FUNCTION "expense_guard"();

-- ---------------------------------------------------------------------------
-- 4. Transfers, drawings and other income are append-only, like capital.
--    A transfer moves money between two different places.
-- ---------------------------------------------------------------------------

ALTER TABLE "bank_transfer"
  ADD CONSTRAINT "bank_transfer_sides_check"
    CHECK (("fromBankAccountId" IS NOT NULL OR "toBankAccountId" IS NOT NULL)
       AND "fromBankAccountId" IS DISTINCT FROM "toBankAccountId");

CREATE FUNCTION "books_entry_reject_mutation"()
RETURNS trigger
LANGUAGE plpgsql
SET search_path FROM CURRENT
AS $$
BEGIN
  RAISE EXCEPTION 'books_entry_append_only: % on % is not permitted', TG_OP, TG_TABLE_NAME;
END;
$$;

CREATE TRIGGER "bank_transfer_append_only" BEFORE UPDATE OR DELETE ON "bank_transfer"
  FOR EACH ROW EXECUTE FUNCTION "books_entry_reject_mutation"();
CREATE TRIGGER "drawing_entry_append_only" BEFORE UPDATE OR DELETE ON "drawing_entry"
  FOR EACH ROW EXECUTE FUNCTION "books_entry_reject_mutation"();
CREATE TRIGGER "income_entry_append_only" BEFORE UPDATE OR DELETE ON "income_entry"
  FOR EACH ROW EXECUTE FUNCTION "books_entry_reject_mutation"();

-- ---------------------------------------------------------------------------
-- 5. Every category, bank and line an entry names is its own organization's.
-- ---------------------------------------------------------------------------

CREATE FUNCTION "books_entry_same_organization"()
RETURNS trigger
LANGUAGE plpgsql
SET search_path FROM CURRENT
AS $$
DECLARE
  row_json jsonb := to_jsonb(NEW);
  bank text;
BEGIN
  IF row_json ? 'expenseCategoryId' AND NOT EXISTS (
    SELECT 1 FROM expense_category c
    WHERE c.id = row_json->>'expenseCategoryId' AND c."organizationId" = NEW."organizationId"
  ) THEN
    RAISE EXCEPTION 'books_entry_same_organization: the expense category is another organization''s';
  END IF;
  IF row_json->>'lineId' IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM line l
    WHERE l.id = row_json->>'lineId' AND l."organizationId" = NEW."organizationId"
  ) THEN
    RAISE EXCEPTION 'books_entry_same_organization: the line is another organization''s';
  END IF;
  FOREACH bank IN ARRAY ARRAY[
    row_json->>'bankAccountId', row_json->>'fromBankAccountId', row_json->>'toBankAccountId'
  ] LOOP
    IF bank IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM bank_account b
      WHERE b.id = bank AND b."organizationId" = NEW."organizationId"
    ) THEN
      RAISE EXCEPTION 'books_entry_same_organization: the bank account is another organization''s';
    END IF;
  END LOOP;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "expense_same_organization" BEFORE INSERT ON "expense"
  FOR EACH ROW EXECUTE FUNCTION "books_entry_same_organization"();
CREATE TRIGGER "bank_transfer_same_organization" BEFORE INSERT ON "bank_transfer"
  FOR EACH ROW EXECUTE FUNCTION "books_entry_same_organization"();
CREATE TRIGGER "drawing_entry_same_organization" BEFORE INSERT ON "drawing_entry"
  FOR EACH ROW EXECUTE FUNCTION "books_entry_same_organization"();
CREATE TRIGGER "income_entry_same_organization" BEFORE INSERT ON "income_entry"
  FOR EACH ROW EXECUTE FUNCTION "books_entry_same_organization"();
