-- Notification, calendar and audit invariants (M10, M13, M15).

-- ---------------------------------------------------------------------------
-- 1. push_subscription — each provider carries exactly its own fields.
-- ---------------------------------------------------------------------------

ALTER TABLE "push_subscription"
  ADD CONSTRAINT "push_subscription_provider_fields_check"
    CHECK (
      ("provider" = 'WEB_PUSH'
        AND "endpoint" IS NOT NULL AND "p256dh" IS NOT NULL AND "auth" IS NOT NULL
        AND "fcmToken" IS NULL)
      OR
      ("provider" = 'FCM'
        AND "fcmToken" IS NOT NULL
        AND "endpoint" IS NULL AND "p256dh" IS NULL AND "auth" IS NULL)
    );

-- ---------------------------------------------------------------------------
-- 2. notification_outbox
-- ---------------------------------------------------------------------------

ALTER TABLE "notification_outbox"
  ADD CONSTRAINT "notification_outbox_attempts_non_negative_check"
    CHECK ("attempts" >= 0),
  ADD CONSTRAINT "notification_outbox_sent_has_timestamp_check"
    CHECK ("status" <> 'SENT' OR "sentAt" IS NOT NULL);

-- ---------------------------------------------------------------------------
-- 3. holiday — one business-wide holiday per date (BR-02).
--
--    The index from 0002 treats NULLs as distinct, so any number of
--    business-wide (sectorId IS NULL) holidays could share a date. Rebuilt with
--    NULLS NOT DISTINCT under the same name and columns, which Prisma cannot
--    express but also does not diff.
-- ---------------------------------------------------------------------------

DROP INDEX "holiday_date_sectorId_key";
CREATE UNIQUE INDEX "holiday_date_sectorId_key"
  ON "holiday"("date", "sectorId") NULLS NOT DISTINCT;

-- ---------------------------------------------------------------------------
-- 4. audit_log — append-only (M13, data-dictionary.md).
--
--    Yearly partitioning stays unscheduled (backlog.md): it forces a composite
--    (id, createdAt) primary key and is not needed at v1 volume.
-- ---------------------------------------------------------------------------

CREATE FUNCTION "audit_log_reject_mutation"()
RETURNS trigger
LANGUAGE plpgsql
SET search_path FROM CURRENT
AS $$
BEGIN
  RAISE EXCEPTION
    'audit_log_append_only: % on audit_log is not permitted',
    TG_OP;
END;
$$;

CREATE TRIGGER "audit_log_append_only"
  BEFORE UPDATE OR DELETE ON "audit_log"
  FOR EACH ROW
  EXECUTE FUNCTION "audit_log_reject_mutation"();
