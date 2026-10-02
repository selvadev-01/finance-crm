-- US-032: money the owner puts into the business funds office cash, which
-- otherwise runs negative as accounts are disbursed (M09). Decided 2026-09-24
-- with the business: a Super Admin records it, and it posts as its own
-- transaction type, so no invested, collected or profit figure reads it.
--
-- Alone, because PostgreSQL cannot use a new enum value in the transaction
-- that adds it.
ALTER TYPE "LedgerTransactionType" ADD VALUE 'CAPITAL';
