-- Corrections and approvals (M07, BR-14, US-044).

-- ---------------------------------------------------------------------------
-- 1. An ORIGINAL collection is a fact about cash that changed hands: it is
--    CONFIRMED from the moment it is written and never anything else. Only an
--    ADJUSTMENT waits for approval.
-- ---------------------------------------------------------------------------

ALTER TABLE "collection"
  ADD CONSTRAINT "collection_original_confirmed_check"
    CHECK ("entryType" = 'ADJUSTMENT' OR "status" = 'CONFIRMED');

-- ---------------------------------------------------------------------------
-- 2. Append-only, now with the status transitions specified: an adjustment
--    is decided once — PENDING_APPROVAL to CONFIRMED or REJECTED — and a
--    decided row never changes again. Everything else is as before.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION "collection_reject_mutation"()
RETURNS trigger
LANGUAGE plpgsql
SET search_path FROM CURRENT
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION
      'collection_append_only: DELETE on collection % is not permitted; insert an ADJUSTMENT instead',
      OLD."id";
  END IF;

  IF (to_jsonb(NEW) - 'status') IS DISTINCT FROM (to_jsonb(OLD) - 'status') THEN
    RAISE EXCEPTION
      'collection_append_only: UPDATE on collection % may change only status; insert an ADJUSTMENT instead',
      OLD."id";
  END IF;

  IF NEW."status" IS DISTINCT FROM OLD."status"
     AND NOT (OLD."status" = 'PENDING_APPROVAL' AND NEW."status" IN ('CONFIRMED', 'REJECTED')) THEN
    RAISE EXCEPTION
      'collection_status_transition: collection % cannot move from % to %; only a pending adjustment is decided, once',
      OLD."id", OLD."status", NEW."status";
  END IF;

  RETURN NEW;
END;
$$;

-- ---------------------------------------------------------------------------
-- 3. One correction at a time per collection. Declared in schema.prisma too
--    (partialIndexes preview); SQL copied from `prisma migrate diff`.
-- ---------------------------------------------------------------------------

CREATE UNIQUE INDEX "collection_one_pending_correction_key" ON "collection"("adjustsCollectionId") WHERE ("status" = 'PENDING_APPROVAL'::"CollectionStatus");
