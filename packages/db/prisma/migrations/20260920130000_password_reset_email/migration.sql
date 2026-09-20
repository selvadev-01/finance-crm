-- US-003: the self-service password reset a Junior can start themselves, now
-- that SMTP is configured. The email is neither a notification copy nor a
-- welcome, so it is its own kind — the email outbox groups and retries by it.
--
-- Alone, because PostgreSQL cannot use a new enum value in the transaction
-- that adds it.
ALTER TYPE "EmailKind" ADD VALUE 'PASSWORD_RESET';
