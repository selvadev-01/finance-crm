-- Ledger accounts belong to an organization (decided 2026-09-13).
--
-- The business-wide types — CASH_AT_OFFICE, CAPITAL, UNEARNED_PROFIT,
-- EARNED_PROFIT — had no owner, so every organization in the database would
-- have posted to the same four accounts. The table is empty when this runs
-- (no account has been disbursed; the seed is not committed), so the column is
-- added NOT NULL without a backfill.

ALTER TABLE "ledger_account" ADD COLUMN "organizationId" TEXT NOT NULL;

CREATE INDEX "ledger_account_organizationId_idx" ON "ledger_account"("organizationId");

-- One of each business-wide account per organization. Declared in
-- schema.prisma (partialIndexes preview); SQL as `prisma migrate diff`
-- generates it.
CREATE UNIQUE INDEX "ledger_account_organization_singleton_key" ON "ledger_account"("organizationId", "accountType") WHERE ("accountType" = ANY (ARRAY['CASH_AT_OFFICE'::"LedgerAccountType", 'CAPITAL'::"LedgerAccountType", 'UNEARNED_PROFIT'::"LedgerAccountType", 'EARNED_PROFIT'::"LedgerAccountType"]));

ALTER TABLE "ledger_account" ADD CONSTRAINT "ledger_account_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
