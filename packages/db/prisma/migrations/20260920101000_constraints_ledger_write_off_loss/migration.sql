-- `WRITE_OFF_LOSS` joins the ledger's invariants (US-035, M09).

-- It is an expense: what the business lost, so debit-normal like the assets
-- above it rather than credit-normal like capital and profit. The previous
-- check treated every type outside the debit list as credit-normal.
ALTER TABLE "ledger_account"
  DROP CONSTRAINT "ledger_account_normal_balance_check",
  ADD CONSTRAINT "ledger_account_normal_balance_check"
    CHECK ("normalBalance" = CASE
      WHEN "accountType" IN ('CASH_IN_HAND', 'CASH_AT_OFFICE', 'LOAN_RECEIVABLE', 'WRITE_OFF_LOSS')
        THEN 'DEBIT'::"Direction"
      ELSE 'CREDIT'::"Direction"
    END);

-- One per organization, like the other business-wide accounts. Declared in
-- schema.prisma (partialIndexes preview); SQL as `prisma migrate diff`
-- generates it.
DROP INDEX "ledger_account_organization_singleton_key";
CREATE UNIQUE INDEX "ledger_account_organization_singleton_key" ON "ledger_account"("organizationId", "accountType") WHERE ("accountType" = ANY (ARRAY['CASH_AT_OFFICE'::"LedgerAccountType", 'CAPITAL'::"LedgerAccountType", 'UNEARNED_PROFIT'::"LedgerAccountType", 'EARNED_PROFIT'::"LedgerAccountType", 'WRITE_OFF_LOSS'::"LedgerAccountType"]));
