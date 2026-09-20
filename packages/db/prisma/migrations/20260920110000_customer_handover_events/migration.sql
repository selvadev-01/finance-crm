-- The two notifications M10's catalogue specifies but nothing raised: a new
-- customer on a Senior's line (US-020, M04) and the acknowledgement that
-- closes a handover, told to the person who handed the cash over (US-062).
--
-- Alone, because PostgreSQL cannot use a new enum value in the transaction
-- that adds it.
ALTER TYPE "NotificationEvent" ADD VALUE 'NEW_CUSTOMER';
ALTER TYPE "NotificationEvent" ADD VALUE 'HANDOVER_ACKNOWLEDGED';
