-- Books slice 3 (ADR-0018) invariants. Specs in
-- apps/api/test/db-constraints/field-expenses.spec.ts.

-- ---------------------------------------------------------------------------
-- 1. A field expense, and only a field expense, names the hop it comes out of.
-- ---------------------------------------------------------------------------

ALTER TABLE "expense"
  ADD CONSTRAINT "expense_hop_check"
    CHECK (("paidFrom" = 'CASH_IN_HAND') = ("hop" IS NOT NULL));

-- ---------------------------------------------------------------------------
-- 2. The hop is part of an expense's source and never changes, like the rest.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION "expense_guard"()
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
     OR NEW."hop" IS DISTINCT FROM OLD."hop"
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

-- ---------------------------------------------------------------------------
-- 3. A line's day: the Juniors' approved field expenses are money spent, not
--    missing, so they count beside the cash handed over (BR-17, ADR-0018).
-- ---------------------------------------------------------------------------

ALTER TABLE "day_close"
  ADD CONSTRAINT "day_close_expense_total_check" CHECK ("expenseTotal" >= 0),
  DROP CONSTRAINT "day_close_discrepancy_derivation_check",
  ADD CONSTRAINT "day_close_discrepancy_derivation_check"
    CHECK ("discrepancy" = "cashReceivedTotal" + "expenseTotal" - "collectedTotal");
