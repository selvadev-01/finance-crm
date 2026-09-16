-- Notification invariants (M10, US-073).

-- ALERT cannot be disabled: low collections, missed visits and cash
-- discrepancies are what the business exists to act on (M10 preferences).
ALTER TABLE "notification_preference"
  ADD CONSTRAINT "notification_preference_alert_always_on_check"
    CHECK ("category" <> 'ALERT' OR "enabled");

-- A notification says something.
ALTER TABLE "notification"
  ADD CONSTRAINT "notification_text_check"
    CHECK (btrim("title") <> '' AND btrim("body") <> '');

-- A failed delivery says why.
ALTER TABLE "notification_outbox"
  ADD CONSTRAINT "notification_outbox_failed_has_error_check"
    CHECK ("status" <> 'FAILED' OR "lastError" IS NOT NULL);
