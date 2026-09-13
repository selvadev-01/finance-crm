-- Account amount invariants (BR-01), enforced in the database rather than only
-- in the application: an application check is skippable by the next person in
-- a hurry (coding-guidelines.md#database).
--
-- Prisma's schema language cannot express CHECK constraints, so they live here.
-- Prisma does not diff CHECK constraints either, so `migrate dev` will not try
-- to drop them.

-- A > 0, I > 0, D > 0, N > 0
ALTER TABLE "account_loan"
  ADD CONSTRAINT "account_loan_account_amount_positive_check"
    CHECK ("accountAmount" > 0),
  ADD CONSTRAINT "account_loan_invested_amount_positive_check"
    CHECK ("investedAmount" > 0),
  ADD CONSTRAINT "account_loan_daily_amount_positive_check"
    CHECK ("dailyAmount" > 0),
  ADD CONSTRAINT "account_loan_term_days_positive_check"
    CHECK ("termDays" > 0);

-- I < A: profit cannot be zero or negative.
ALTER TABLE "account_loan"
  ADD CONSTRAINT "account_loan_invested_below_account_check"
    CHECK ("investedAmount" < "accountAmount");

-- P = A - I. Stored rather than generated so the column reads like any other,
-- but it can never disagree with its inputs.
ALTER TABLE "account_loan"
  ADD CONSTRAINT "account_loan_profit_derivation_check"
    CHECK ("profitAmount" = "accountAmount" - "investedAmount");

-- D <= A: a single day cannot exceed the whole account.
ALTER TABLE "account_loan"
  ADD CONSTRAINT "account_loan_daily_within_account_check"
    CHECK ("dailyAmount" <= "accountAmount");

-- D x N >= A: the schedule must be able to clear the account within its term.
ALTER TABLE "account_loan"
  ADD CONSTRAINT "account_loan_term_clears_account_check"
    CHECK ("dailyAmount" * "termDays" >= "accountAmount");

-- The collected cache never goes below zero. Corrections are ADJUSTMENT rows
-- (BR-14), and no sequence of them can un-collect more than was collected.
ALTER TABLE "account_loan"
  ADD CONSTRAINT "account_loan_collected_non_negative_check"
    CHECK ("collectedAmount" >= 0);
