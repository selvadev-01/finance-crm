-- Collection invariants (M07, BR-08, BR-13, BR-14, ADR-0006).
--
-- Non-negotiable 4: collections are never updated or deleted. A correction
-- inserts an ADJUSTMENT row. The API has no such route; this makes the edit
-- impossible rather than merely unexposed.

-- ---------------------------------------------------------------------------
-- 1. Row shape
-- ---------------------------------------------------------------------------

ALTER TABLE "collection"
  ADD CONSTRAINT "collection_variance_derivation_check"
    CHECK ("variance" = "amount" - "expectedAmount"),
  ADD CONSTRAINT "collection_expected_non_negative_check"
    CHECK ("expectedAmount" >= 0),
  -- 0 is valid (NO_PAYMENT); negative only on an ADJUSTMENT.
  ADD CONSTRAINT "collection_amount_sign_check"
    CHECK ("amount" >= 0 OR "entryType" = 'ADJUSTMENT'),
  -- An ADJUSTMENT always names the row it corrects; an ORIGINAL never does.
  ADD CONSTRAINT "collection_adjustment_reference_check"
    CHECK (("entryType" = 'ADJUSTMENT') = ("adjustsCollectionId" IS NOT NULL)),
  ADD CONSTRAINT "collection_adjustment_not_self_check"
    CHECK ("adjustsCollectionId" IS NULL OR "adjustsCollectionId" <> "id"),
  -- accountScheduleId is null for adjustments (data-dictionary.md).
  ADD CONSTRAINT "collection_adjustment_unscheduled_check"
    CHECK ("entryType" = 'ORIGINAL' OR "accountScheduleId" IS NULL);

-- BR-08 classification, exact match with no tolerance band. Applies to
-- ORIGINAL rows only; BR-08 does not classify corrections.
--
-- If the deferred `collection.varianceTolerance` setting (BR-08) is ever built,
-- CORRECT/LOW/EXTRA stop being a pure function of the row and this constraint
-- must be relaxed in the same change.
ALTER TABLE "collection"
  ADD CONSTRAINT "collection_classification_check"
    CHECK ("entryType" = 'ADJUSTMENT' OR CASE "classification"
      WHEN 'NO_PAYMENT' THEN "amount" = 0
      WHEN 'CORRECT'    THEN "amount" > 0 AND "variance" = 0
      WHEN 'LOW'        THEN "amount" > 0 AND "variance" < 0
      WHEN 'EXTRA'      THEN "amount" > 0 AND "variance" > 0
    END);

-- ---------------------------------------------------------------------------
-- 2. Append-only. `status` is the only column that may change — its
--    transitions are audited (data-dictionary.md). Comparing the whole row as
--    jsonb minus `status` means a column added later is protected by default
--    instead of silently becoming editable.
--
--    Row-level triggers do not fire on TRUNCATE.
-- ---------------------------------------------------------------------------

CREATE FUNCTION "collection_reject_mutation"()
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

  RETURN NEW;
END;
$$;

CREATE TRIGGER "collection_append_only"
  BEFORE UPDATE OR DELETE ON "collection"
  FOR EACH ROW
  EXECUTE FUNCTION "collection_reject_mutation"();

-- ---------------------------------------------------------------------------
-- 3. collection_approval — a decision is recorded completely or not at all.
-- ---------------------------------------------------------------------------

ALTER TABLE "collection_approval"
  ADD CONSTRAINT "collection_approval_decided_by_check"
    CHECK (("decision" = 'PENDING') = ("decidedByUserId" IS NULL)),
  ADD CONSTRAINT "collection_approval_decided_at_check"
    CHECK (("decision" = 'PENDING') = ("decidedAt" IS NULL)),
  -- Required from the requester. Blank is not a reason.
  ADD CONSTRAINT "collection_approval_reason_check"
    CHECK (btrim("reason") <> '');
