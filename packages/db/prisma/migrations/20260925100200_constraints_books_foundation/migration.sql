-- Books (ADR-0017) invariants, and the starter expense categories.
-- Specs in apps/api/test/db-constraints/books-foundation.spec.ts.

-- ---------------------------------------------------------------------------
-- 1. An EXPENSE account totals one category and a BANK account mirrors one
--    bank — and no other type carries either reference, exactly as
--    CASH_IN_HAND carries an owner and LOAN_RECEIVABLE a loan.
-- ---------------------------------------------------------------------------

ALTER TABLE "ledger_account"
  ADD CONSTRAINT "ledger_account_expense_category_check"
    CHECK (("accountType" = 'EXPENSE') = ("expenseCategoryId" IS NOT NULL)),
  ADD CONSTRAINT "ledger_account_bank_account_check"
    CHECK (("accountType" = 'BANK') = ("bankAccountId" IS NOT NULL));

-- ---------------------------------------------------------------------------
-- 2. Normal balances. Expenses, banks and drawings are debit-normal; other
--    income is credit-normal like profit. A type left out of the debit list
--    silently becomes credit-normal, so every debit type is named.
-- ---------------------------------------------------------------------------

ALTER TABLE "ledger_account"
  DROP CONSTRAINT "ledger_account_normal_balance_check",
  ADD CONSTRAINT "ledger_account_normal_balance_check"
    CHECK ("normalBalance" = CASE
      WHEN "accountType" IN (
        'CASH_IN_HAND', 'CASH_AT_OFFICE', 'LOAN_RECEIVABLE', 'WRITE_OFF_LOSS',
        'EXPENSE', 'BANK', 'OWNER_DRAWINGS'
      )
        THEN 'DEBIT'::"Direction"
      ELSE 'CREDIT'::"Direction"
    END);

-- ---------------------------------------------------------------------------
-- 3. A ledger account's category or bank is its own organization's.
-- ---------------------------------------------------------------------------

CREATE FUNCTION "ledger_account_reference_same_organization"()
RETURNS trigger
LANGUAGE plpgsql
SET search_path FROM CURRENT
AS $$
BEGIN
  IF NEW."expenseCategoryId" IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM expense_category c
    WHERE c.id = NEW."expenseCategoryId" AND c."organizationId" = NEW."organizationId"
  ) THEN
    RAISE EXCEPTION
      'ledger_account_reference_same_organization: expense category % is another organization''s',
      NEW."expenseCategoryId";
  END IF;
  IF NEW."bankAccountId" IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM bank_account b
    WHERE b.id = NEW."bankAccountId" AND b."organizationId" = NEW."organizationId"
  ) THEN
    RAISE EXCEPTION
      'ledger_account_reference_same_organization: bank account % is another organization''s',
      NEW."bankAccountId";
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "ledger_account_reference_same_organization"
  BEFORE INSERT OR UPDATE OF "expenseCategoryId", "bankAccountId", "organizationId"
  ON "ledger_account"
  FOR EACH ROW
  EXECUTE FUNCTION "ledger_account_reference_same_organization"();

-- ---------------------------------------------------------------------------
-- 4. Names: not blank, one per organization whatever the case or spacing.
--    A bank's last four digits are four digits, never the whole number.
-- ---------------------------------------------------------------------------

ALTER TABLE "expense_category"
  ADD CONSTRAINT "expense_category_name_not_blank_check"
    CHECK (length(btrim("name")) > 0);
CREATE UNIQUE INDEX "expense_category_organization_name_key"
  ON "expense_category" ("organizationId", lower(btrim("name")));

ALTER TABLE "bank_account"
  ADD CONSTRAINT "bank_account_name_not_blank_check"
    CHECK (length(btrim("name")) > 0),
  ADD CONSTRAINT "bank_account_last4_check"
    CHECK ("last4" IS NULL OR "last4" ~ '^[0-9]{4}$');
CREATE UNIQUE INDEX "bank_account_organization_name_key"
  ON "bank_account" ("organizationId", lower(btrim("name")));

-- ---------------------------------------------------------------------------
-- 5. The starter categories, for every organization that exists today. A new
--    organization gets the same list at sign-up (OrganizationSignUpService).
-- ---------------------------------------------------------------------------

INSERT INTO "expense_category" ("id", "organizationId", "name", "updatedAt")
SELECT gen_random_uuid()::text, o.id, starter.name, CURRENT_TIMESTAMP
FROM "organization" o
CROSS JOIN (VALUES
  ('Salary'), ('Rent'), ('Fuel & travel'), ('Phone & internet'),
  ('Stationery & printing'), ('Bank charges'), ('Interest paid'),
  ('Miscellaneous')
) AS starter(name);
