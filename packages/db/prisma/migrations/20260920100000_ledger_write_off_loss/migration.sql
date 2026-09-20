-- Where a written-off account's unrecovered money lands (US-035, M09).
--
-- Alone in its own migration: PostgreSQL cannot use a new enum value in the
-- transaction that adds it, so the constraint and index that name it follow in
-- `constraints_ledger_write_off_loss`.

ALTER TYPE "LedgerAccountType" ADD VALUE 'WRITE_OFF_LOSS';
