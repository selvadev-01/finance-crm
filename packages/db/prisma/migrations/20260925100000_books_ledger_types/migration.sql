-- Books (ADR-0017): the ledger learns expenses, banks, other income, owner
-- drawings and manual journals.
--
-- Alone, because PostgreSQL cannot use a new enum value in the transaction
-- that adds it; the tables and constraints that use them follow.
ALTER TYPE "LedgerAccountType" ADD VALUE 'EXPENSE';
ALTER TYPE "LedgerAccountType" ADD VALUE 'BANK';
ALTER TYPE "LedgerAccountType" ADD VALUE 'OTHER_INCOME';
ALTER TYPE "LedgerAccountType" ADD VALUE 'OWNER_DRAWINGS';

ALTER TYPE "LedgerTransactionType" ADD VALUE 'EXPENSE';
ALTER TYPE "LedgerTransactionType" ADD VALUE 'BANK_TRANSFER';
ALTER TYPE "LedgerTransactionType" ADD VALUE 'DRAWINGS';
ALTER TYPE "LedgerTransactionType" ADD VALUE 'OTHER_INCOME';
ALTER TYPE "LedgerTransactionType" ADD VALUE 'JOURNAL';
