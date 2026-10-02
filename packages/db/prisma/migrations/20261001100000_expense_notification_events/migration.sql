-- Books slice 3 (ADR-0018): a field expense to approve, and its decision.
-- Alone in their migration: PostgreSQL cannot use a new enum value in the
-- transaction that adds it.

ALTER TYPE "NotificationEvent" ADD VALUE 'EXPENSE_REQUESTED';
ALTER TYPE "NotificationEvent" ADD VALUE 'EXPENSE_DECIDED';
