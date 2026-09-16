-- Day close and cash handovers (M08, BR-16, BR-16a, BR-17).

-- A phone cannot report fewer than no unsent collections, and names the oldest
-- exactly when it has some.
ALTER TABLE "device_sync_report"
  ADD CONSTRAINT "device_sync_report_unsent_non_negative_check"
    CHECK ("unsentCount" >= 0),
  ADD CONSTRAINT "device_sync_report_oldest_when_unsent_check"
    CHECK (("unsentCount" = 0) = ("oldestUnsentAt" IS NULL));

-- A dispute always says why (US-063); only a dispute carries a note.
ALTER TABLE "cash_handover"
  ADD CONSTRAINT "cash_handover_dispute_note_check"
    CHECK (("status" = 'DISPUTED') = ("disputeNote" IS NOT NULL AND btrim("disputeNote") <> ''));

-- A manual reopen gives a reason; blank is not one. Null is the automatic
-- reopen of a late sync (BR-16a).
ALTER TABLE "day_close"
  ADD CONSTRAINT "day_close_reopen_reason_check"
    CHECK ("reopenReason" IS NULL OR btrim("reopenReason") <> '');
