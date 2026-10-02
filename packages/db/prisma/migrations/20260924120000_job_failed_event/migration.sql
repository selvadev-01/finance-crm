-- M14: a scheduled job that exhausts its retries alerts the organization's
-- Admins and Super Admins (M14 retry policy: "dead-lettered jobs alert
-- Admin"). Until now the dead-letter handler only logged, which nobody reads.
--
-- Alone, because PostgreSQL cannot use a new enum value in the transaction
-- that adds it.
ALTER TYPE "NotificationEvent" ADD VALUE 'JOB_FAILED';
