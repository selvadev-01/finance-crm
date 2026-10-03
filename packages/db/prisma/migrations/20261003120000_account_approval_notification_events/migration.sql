-- A Senior's account waiting for approval, and its approval (decided
-- 2026-10-03). Alone in their migration: PostgreSQL cannot use a new enum
-- value in the transaction that adds it.

ALTER TYPE "NotificationEvent" ADD VALUE 'ACCOUNT_APPROVAL_REQUESTED';
ALTER TYPE "NotificationEvent" ADD VALUE 'ACCOUNT_APPROVED';
