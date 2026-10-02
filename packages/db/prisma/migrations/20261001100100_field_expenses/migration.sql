-- Books slice 3 (ADR-0018): field expenses paid from collected cash.
-- An expense records whose handover it comes out of; a line's day stores the
-- Juniors' approved field expenses beside the cash they handed over.

ALTER TABLE "expense" ADD COLUMN "hop" "HandoverHop";

ALTER TABLE "day_close" ADD COLUMN "expenseTotal" DECIMAL(14,2) NOT NULL DEFAULT 0;
