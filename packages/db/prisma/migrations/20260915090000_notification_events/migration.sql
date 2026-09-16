-- M10: events raised by features shipped since the notification spec was
-- written — no-payment visits (US-072), handovers (US-061, US-063), automatic
-- reopen (BR-16a) and reconciliation (US-095). Alone, because PostgreSQL cannot
-- use a new enum value in the transaction that adds it.
ALTER TYPE "NotificationEvent" ADD VALUE 'NO_PAYMENT_COLLECTION';
ALTER TYPE "NotificationEvent" ADD VALUE 'HANDOVER_SUBMITTED';
ALTER TYPE "NotificationEvent" ADD VALUE 'HANDOVER_DISPUTED';
ALTER TYPE "NotificationEvent" ADD VALUE 'DAY_REOPENED';
ALTER TYPE "NotificationEvent" ADD VALUE 'RECONCILIATION_MISMATCH';
