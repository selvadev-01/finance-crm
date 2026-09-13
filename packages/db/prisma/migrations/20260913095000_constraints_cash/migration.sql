-- Cash control invariants (M08, BR-16, BR-17).

-- ---------------------------------------------------------------------------
-- 1. day_close
-- ---------------------------------------------------------------------------

ALTER TABLE "day_close"
  ADD CONSTRAINT "day_close_discrepancy_derivation_check"
    CHECK ("discrepancy" = "cashReceivedTotal" - "collectedTotal"),
  ADD CONSTRAINT "day_close_expected_non_negative_check"
    CHECK ("expectedTotal" >= 0),
  -- Physical cash received cannot be negative. collectedTotal deliberately has
  -- no floor: a negative ADJUSTMENT dated today for an earlier collection can
  -- take one day's confirmed total below zero.
  ADD CONSTRAINT "day_close_cash_received_non_negative_check"
    CHECK ("cashReceivedTotal" >= 0),
  ADD CONSTRAINT "day_close_closed_has_timestamp_check"
    CHECK ("status" NOT IN ('CLOSED', 'TALLIED') OR "closedAt" IS NOT NULL),
  -- TALLIED is CLOSED with discrepancy = 0 and every handover acknowledged.
  -- The handover half spans tables and is enforced by the day-close service.
  ADD CONSTRAINT "day_close_tallied_zero_discrepancy_check"
    CHECK ("status" <> 'TALLIED' OR "discrepancy" = 0);

-- ---------------------------------------------------------------------------
-- 2. cash_handover
-- ---------------------------------------------------------------------------

ALTER TABLE "cash_handover"
  ADD CONSTRAINT "cash_handover_discrepancy_derivation_check"
    CHECK ("discrepancy" = "declaredAmount" - "systemAmount"),
  ADD CONSTRAINT "cash_handover_declared_non_negative_check"
    CHECK ("declaredAmount" >= 0),
  ADD CONSTRAINT "cash_handover_distinct_parties_check"
    CHECK ("fromUserId" <> "toUserId"),
  -- BR-17: cash has not moved until acknowledgedAt is set, and it is set only
  -- by acknowledgement.
  ADD CONSTRAINT "cash_handover_acknowledged_at_check"
    CHECK (("status" = 'ACKNOWLEDGED') = ("acknowledgedAt" IS NOT NULL));

-- ---------------------------------------------------------------------------
-- 3. cash_denomination
-- ---------------------------------------------------------------------------

ALTER TABLE "cash_denomination"
  ADD CONSTRAINT "cash_denomination_value_check"
    CHECK ("denomination" IN (500, 200, 100, 50, 20, 10, 5, 2, 1)),
  ADD CONSTRAINT "cash_denomination_count_non_negative_check"
    CHECK ("count" >= 0),
  ADD CONSTRAINT "cash_denomination_subtotal_derivation_check"
    CHECK ("subtotal" = "denomination" * "count");

-- ---------------------------------------------------------------------------
-- 4. Σ cash_denomination.subtotal = cash_handover.declaredAmount, at COMMIT.
--
--    Deferred for the same reason as the ledger: a handover and its
--    denominations are several statements, consistent only once all are
--    written. Fires on every write that can change either side of the
--    equation.
-- ---------------------------------------------------------------------------

CREATE FUNCTION "cash_assert_handover_counted"(handover_id text)
RETURNS void
LANGUAGE plpgsql
SET search_path FROM CURRENT
AS $$
DECLARE
  declared numeric(14, 2);
  counted  numeric(14, 2);
BEGIN
  SELECT "declaredAmount" INTO declared
  FROM "cash_handover"
  WHERE "id" = handover_id;

  -- Deleted in the same transaction (denominations cascade): nothing to check.
  IF NOT FOUND THEN
    RETURN;
  END IF;

  SELECT COALESCE(SUM("subtotal"), 0) INTO counted
  FROM "cash_denomination"
  WHERE "cashHandoverId" = handover_id;

  IF counted <> declared THEN
    RAISE EXCEPTION
      'cash_handover_denominations_match: handover % declares % but denominations total %',
      handover_id, declared, counted
      USING ERRCODE = 'check_violation';
  END IF;
END;
$$;

CREATE FUNCTION "cash_denomination_check_counted"()
RETURNS trigger
LANGUAGE plpgsql
SET search_path FROM CURRENT
AS $$
BEGIN
  IF TG_OP IN ('UPDATE', 'DELETE') THEN
    PERFORM "cash_assert_handover_counted"(OLD."cashHandoverId");
  END IF;
  IF TG_OP IN ('INSERT', 'UPDATE') THEN
    PERFORM "cash_assert_handover_counted"(NEW."cashHandoverId");
  END IF;
  RETURN NULL;
END;
$$;

CREATE FUNCTION "cash_handover_check_counted"()
RETURNS trigger
LANGUAGE plpgsql
SET search_path FROM CURRENT
AS $$
BEGIN
  PERFORM "cash_assert_handover_counted"(NEW."id");
  RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER "cash_denomination_counted"
  AFTER INSERT OR UPDATE OR DELETE ON "cash_denomination"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW
  EXECUTE FUNCTION "cash_denomination_check_counted"();

CREATE CONSTRAINT TRIGGER "cash_handover_counted"
  AFTER INSERT OR UPDATE OF "declaredAmount" ON "cash_handover"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW
  EXECUTE FUNCTION "cash_handover_check_counted"();
