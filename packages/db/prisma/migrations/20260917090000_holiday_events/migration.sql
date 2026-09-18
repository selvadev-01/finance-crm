-- US-093: declaring or removing a future holiday changes the routes of the
-- lines it covers, and their staff are told (M06, M10). Alone, because
-- PostgreSQL cannot use a new enum value in the transaction that adds it.
ALTER TYPE "NotificationEvent" ADD VALUE 'HOLIDAY_DECLARED';
ALTER TYPE "NotificationEvent" ADD VALUE 'HOLIDAY_REMOVED';
