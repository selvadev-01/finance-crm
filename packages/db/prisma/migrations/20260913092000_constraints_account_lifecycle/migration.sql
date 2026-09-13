-- Account lifecycle and schedule invariants (BR-01, BR-03, BR-05, BR-07).
-- The amount checks are in constraints_account_loan.

-- ---------------------------------------------------------------------------
-- account_loan
-- ---------------------------------------------------------------------------

ALTER TABLE "account_loan"
  -- BR-03: disbursement is day 0 and not itself a collection day.
  ADD CONSTRAINT "account_loan_first_collection_after_disbursement_check"
    CHECK ("firstCollectionDate" > "disbursementDate"),
  -- Set when status -> COMPLETED (data-dictionary.md).
  ADD CONSTRAINT "account_loan_completed_has_date_check"
    CHECK ("status" <> 'COMPLETED' OR "actualCompletionDate" IS NOT NULL),
  ADD CONSTRAINT "account_loan_completion_after_disbursement_check"
    CHECK ("actualCompletionDate" IS NULL OR "actualCompletionDate" > "disbursementDate"),
  -- Required for DEFAULTED and WRITTEN_OFF. Blank is not a note.
  ADD CONSTRAINT "account_loan_closure_note_check"
    CHECK ("status" NOT IN ('DEFAULTED', 'WRITTEN_OFF')
           OR btrim(coalesce("closureNote", '')) <> ''),
  -- BR-05: overdue is a flag on ACTIVE, not a status of its own. Whatever moves
  -- an account out of ACTIVE clears the flag in the same write.
  ADD CONSTRAINT "account_loan_overdue_only_active_check"
    CHECK (NOT "isOverdue" OR "status" = 'ACTIVE');

-- A and I are immutable after disbursement (data-dictionary.md). P is pinned to
-- them by account_loan_profit_derivation_check, so it is covered too. While the
-- account is still PENDING the figures may be corrected.
CREATE FUNCTION "account_loan_reject_amount_change"()
RETURNS trigger
LANGUAGE plpgsql
SET search_path FROM CURRENT
AS $$
BEGIN
  IF OLD."status" <> 'PENDING'
     AND (NEW."accountAmount" IS DISTINCT FROM OLD."accountAmount"
          OR NEW."investedAmount" IS DISTINCT FROM OLD."investedAmount") THEN
    RAISE EXCEPTION
      'account_loan_amounts_immutable: account % is %; accountAmount and investedAmount cannot change after disbursement',
      OLD."id", OLD."status";
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "account_loan_amounts_immutable"
  BEFORE UPDATE OF "accountAmount", "investedAmount" ON "account_loan"
  FOR EACH ROW
  EXECUTE FUNCTION "account_loan_reject_amount_change"();

-- ---------------------------------------------------------------------------
-- account_schedule
-- ---------------------------------------------------------------------------

ALTER TABLE "account_schedule"
  -- 1-based (data-dictionary.md).
  ADD CONSTRAINT "account_schedule_sequence_positive_check"
    CHECK ("sequence" >= 1),
  -- BR-07: min(D, outstanding at generation). Both are positive when a slot is
  -- generated, so a slot never expects zero.
  ADD CONSTRAINT "account_schedule_expected_positive_check"
    CHECK ("expectedAmount" > 0);
