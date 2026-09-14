-- US-044: a correction the approver refuses ends REJECTED — never applied,
-- still visible in history (M07 state diagram). Its own migration because
-- PostgreSQL cannot use a new enum value in the transaction that adds it.
ALTER TYPE "CollectionStatus" ADD VALUE 'REJECTED';
