-- M12 export entries (audit_export). An EXPORT is always a person taking a
-- named export, and it is the only thing written against the `export`
-- pseudo-table:
--
-- - `entityTable` is 'export' exactly when the action is EXPORT, so the log's
--   entity filter finds every export and nothing else;
-- - an export has an actor — a scheduled job never downloads a file;
-- - an export records what was taken (`after`: format, filters, rows).
--
-- No existing row is an EXPORT or names 'export', so the check is validated.

ALTER TABLE "audit_log"
  ADD CONSTRAINT "audit_log_export_check"
  CHECK (
    ("action" = 'EXPORT') = ("entityTable" = 'export')
    AND (
      "action" <> 'EXPORT'
      OR ("actorUserId" IS NOT NULL AND "after" IS NOT NULL)
    )
  );
