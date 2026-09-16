-- email_outbox invariants (M10, notifications.md#email), the same rules as
-- notification_outbox plus the ones only email has.

ALTER TABLE "email_outbox"
  ADD CONSTRAINT "email_outbox_attempts_non_negative_check"
    CHECK ("attempts" >= 0),
  ADD CONSTRAINT "email_outbox_sent_has_timestamp_check"
    CHECK ("status" <> 'SENT' OR "sentAt" IS NOT NULL),
  ADD CONSTRAINT "email_outbox_failed_has_error_check"
    CHECK ("status" <> 'FAILED' OR "lastError" IS NOT NULL),
  -- A notification email points at its notification; any other kind does not.
  ADD CONSTRAINT "email_outbox_notification_kind_check"
    CHECK (("kind" = 'NOTIFICATION') = ("notificationId" IS NOT NULL)),
  ADD CONSTRAINT "email_outbox_content_check"
    CHECK (btrim("subject") <> '' AND btrim("textBody") <> '');
