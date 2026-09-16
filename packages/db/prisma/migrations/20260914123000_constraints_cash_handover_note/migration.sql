-- S-06: a handover whose count differs from what Rasi recorded says why.
-- A short handover is never blocked (BR-17); an unexplained one is.

ALTER TABLE "cash_handover"
  ADD CONSTRAINT "cash_handover_discrepancy_note_check"
    CHECK ("discrepancy" = 0 OR ("note" IS NOT NULL AND btrim("note") <> ''));
