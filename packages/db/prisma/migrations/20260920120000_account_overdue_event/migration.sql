-- US-033/BR-05: an account past its target with money still owed. M05 always
-- sent this event to M10; M10 never catalogued it, so nothing was raised.
-- Decided 2026-09-20 with the business: the line's Senior hears it, as a
-- WARNING rather than an ALERT — going overdue is expected on a slow account,
-- and the loud events stay low and no-payment visits.
--
-- Alone, because PostgreSQL cannot use a new enum value in the transaction
-- that adds it.
ALTER TYPE "NotificationEvent" ADD VALUE 'ACCOUNT_OVERDUE';
