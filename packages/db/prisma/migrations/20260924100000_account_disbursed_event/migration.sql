-- US-032: a disbursed account puts a new customer on tomorrow's round.
-- Decided 2026-09-24 with the business: the Senior of the customer's line
-- hears it, as INFORMATION — it is routine, and the Admin who disbursed is
-- never told of their own action. A mid-term account (US-030a) raises it too,
-- since it joins the round the same way.
--
-- Alone, because PostgreSQL cannot use a new enum value in the transaction
-- that adds it.
ALTER TYPE "NotificationEvent" ADD VALUE 'ACCOUNT_DISBURSED';
