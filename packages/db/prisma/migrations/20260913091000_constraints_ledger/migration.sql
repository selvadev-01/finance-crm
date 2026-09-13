-- Ledger invariants (BR-18, ADR-0006).
--
-- ADR-0006 rejected enforcing the balance in application code: "an application
-- check is skippable by the next developer in a hurry. A database constraint is
-- not, and this is the one invariant worth a trigger."
--
-- Every function below pins `search_path FROM CURRENT` — the schema this
-- migration ran in. The runtime client qualifies generated queries with the
-- URL's `?schema=` but does not set search_path, so an unpinned function would
-- resolve `ledger_entry` against whatever the session's search_path happens to
-- be rather than the schema its trigger is attached to.

-- ---------------------------------------------------------------------------
-- 0. ledger_account shape (BR-18, data-dictionary.md).
-- ---------------------------------------------------------------------------

-- CASH_IN_HAND belongs to exactly one staff member; LOAN_RECEIVABLE to exactly
-- one account. No other type carries either reference.
ALTER TABLE "ledger_account"
  ADD CONSTRAINT "ledger_account_owner_matches_type_check"
    CHECK (("accountType" = 'CASH_IN_HAND') = ("ownerUserId" IS NOT NULL)),
  ADD CONSTRAINT "ledger_account_loan_matches_type_check"
    CHECK (("accountType" = 'LOAN_RECEIVABLE') = ("accountLoanId" IS NOT NULL));

-- Assets are debit-normal; capital, unearned profit (a liability) and earned
-- profit (income) are credit-normal. A wrong normalBalance silently flips the
-- sign of every balance shown for that account.
ALTER TABLE "ledger_account"
  ADD CONSTRAINT "ledger_account_normal_balance_check"
    CHECK ("normalBalance" = CASE
      WHEN "accountType" IN ('CASH_IN_HAND', 'CASH_AT_OFFICE', 'LOAN_RECEIVABLE')
        THEN 'DEBIT'::"Direction"
      ELSE 'CREDIT'::"Direction"
    END);

-- One CASH_IN_HAND per staff member, one LOAN_RECEIVABLE per account. Declared
-- in schema.prisma (partialIndexes preview); SQL as `prisma migrate diff`
-- generates it.
CREATE UNIQUE INDEX "ledger_account_cash_in_hand_owner_key" ON "ledger_account"("ownerUserId") WHERE ("accountType" = 'CASH_IN_HAND'::"LedgerAccountType");
CREATE UNIQUE INDEX "ledger_account_loan_receivable_key" ON "ledger_account"("accountLoanId") WHERE ("accountType" = 'LOAN_RECEIVABLE'::"LedgerAccountType");

-- ---------------------------------------------------------------------------
-- 1. Entry amounts are strictly positive. Direction carries the sign.
-- ---------------------------------------------------------------------------

ALTER TABLE "ledger_entry"
  ADD CONSTRAINT "ledger_entry_amount_positive_check"
    CHECK ("amount" > 0);

-- ---------------------------------------------------------------------------
-- 2. Σ debits = Σ credits per transaction, with at least two entries, checked
--    at COMMIT.
--
--    Deferred because a posting is several INSERTs: the transaction is
--    unbalanced after the first entry and balanced only after the last. The
--    trigger fires once per affected row; each check is an indexed sum over a
--    handful of entries (ledger_entry_ledgerTransactionId_idx).
--
--    Two triggers call the same check. The one on ledger_entry catches an
--    unbalanced set of entries. The one on ledger_transaction catches a
--    transaction row committed with no entries at all, which the entry trigger
--    never sees.
-- ---------------------------------------------------------------------------

CREATE FUNCTION "ledger_assert_transaction_balanced"(transaction_id text)
RETURNS void
LANGUAGE plpgsql
SET search_path FROM CURRENT
AS $$
DECLARE
  debit_total  numeric(14, 2);
  credit_total numeric(14, 2);
  entry_count  integer;
BEGIN
  SELECT
    COALESCE(SUM("amount") FILTER (WHERE "direction" = 'DEBIT'), 0),
    COALESCE(SUM("amount") FILTER (WHERE "direction" = 'CREDIT'), 0),
    COUNT(*)
  INTO debit_total, credit_total, entry_count
  FROM "ledger_entry"
  WHERE "ledgerTransactionId" = transaction_id;

  -- A transaction deleted in the same database transaction has nothing left to
  -- balance. Deletes are blocked below, so this only matters if that block is
  -- ever lifted; it keeps the two rules independent.
  IF NOT EXISTS (SELECT 1 FROM "ledger_transaction" WHERE "id" = transaction_id) THEN
    RETURN;
  END IF;

  IF entry_count < 2 THEN
    RAISE EXCEPTION
      'ledger_transaction_balanced: transaction % has % entries; a posting needs at least two',
      transaction_id, entry_count
      USING ERRCODE = 'check_violation';
  END IF;

  IF debit_total <> credit_total THEN
    RAISE EXCEPTION
      'ledger_transaction_balanced: transaction % debits % <> credits %',
      transaction_id, debit_total, credit_total
      USING ERRCODE = 'check_violation';
  END IF;
END;
$$;

CREATE FUNCTION "ledger_entry_check_balanced"()
RETURNS trigger
LANGUAGE plpgsql
SET search_path FROM CURRENT
AS $$
BEGIN
  PERFORM "ledger_assert_transaction_balanced"(NEW."ledgerTransactionId");
  RETURN NULL;
END;
$$;

CREATE FUNCTION "ledger_transaction_check_balanced"()
RETURNS trigger
LANGUAGE plpgsql
SET search_path FROM CURRENT
AS $$
BEGIN
  PERFORM "ledger_assert_transaction_balanced"(NEW."id");
  RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER "ledger_entry_balanced"
  AFTER INSERT ON "ledger_entry"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW
  EXECUTE FUNCTION "ledger_entry_check_balanced"();

CREATE CONSTRAINT TRIGGER "ledger_transaction_balanced"
  AFTER INSERT ON "ledger_transaction"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW
  EXECUTE FUNCTION "ledger_transaction_check_balanced"();

-- ---------------------------------------------------------------------------
-- 3. Append-only. ledger_transaction and ledger_entry reject UPDATE and DELETE
--    (data-dictionary.md: "All three tables are append-only"). A correction is
--    a new ADJUSTMENT transaction, never an edit.
--
--    ledger_account is deliberately excluded: its `balance` is a cache rebuilt
--    by nightly reconciliation (see the NOTE on model LedgerAccount).
--
--    Row-level triggers do not fire on TRUNCATE, so the test harness's
--    truncation is unaffected.
--
--    The error keeps plpgsql's default SQLSTATE (P0001 raise_exception) on
--    purpose. Prisma's pg adapter maps `restrict_violation` (23001) to "Foreign
--    key constraint violated on the (not available)" and discards the message,
--    which would send the next developer hunting for a foreign key.
-- ---------------------------------------------------------------------------

CREATE FUNCTION "ledger_reject_mutation"()
RETURNS trigger
LANGUAGE plpgsql
SET search_path FROM CURRENT
AS $$
BEGIN
  RAISE EXCEPTION
    'ledger_append_only: % on % is not permitted; post an ADJUSTMENT transaction instead',
    TG_OP, TG_TABLE_NAME;
END;
$$;

CREATE TRIGGER "ledger_transaction_append_only"
  BEFORE UPDATE OR DELETE ON "ledger_transaction"
  FOR EACH ROW
  EXECUTE FUNCTION "ledger_reject_mutation"();

CREATE TRIGGER "ledger_entry_append_only"
  BEFORE UPDATE OR DELETE ON "ledger_entry"
  FOR EACH ROW
  EXECUTE FUNCTION "ledger_reject_mutation"();
