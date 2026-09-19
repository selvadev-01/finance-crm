-- What a security_event row may hold (data-dictionary.md#security_event).
--
-- 1. A security event records a REFUSAL, so the status is always a 4xx. A 2xx
--    or a 5xx row would mean the recorder fired on a path that was not refused,
--    or on an infrastructure failure, and would make the log unreadable as
--    "attempts that were turned away".
-- 2. The method and path identify the route that was attempted. A blank or
--    relative path would make the row unattributable, so both are shaped.
-- 3. The code is the stable `AppError` code the caller saw; a blank one would
--    leave nothing to filter or count by.
-- 4. A target is optional — `POST /api/staff` names a role, not an id — and a
--    present one is never blank. A bare id with no table is allowed: a refusal
--    at the guard knows the id the route carried but not what kind of row it
--    is. The reverse is not: a table with nothing to point at says nothing.
--
-- Deliberately absent: an append-only trigger. Unlike `audit_log`, these rows
-- record that nothing happened, and they are pruned and cleaned up by tests
-- (ADR-0014). Immutability here would buy nothing and cost the only database.

ALTER TABLE "security_event"
  ADD CONSTRAINT "security_event_status_refusal_check"
    CHECK ("status" BETWEEN 400 AND 499),
  ADD CONSTRAINT "security_event_method_check"
    CHECK ("method" IN ('GET', 'POST', 'PATCH', 'PUT', 'DELETE')),
  ADD CONSTRAINT "security_event_path_check"
    CHECK ("path" LIKE '/%'),
  ADD CONSTRAINT "security_event_code_not_blank_check"
    CHECK (btrim("code") <> ''),
  ADD CONSTRAINT "security_event_target_table_not_blank_check"
    CHECK ("targetTable" IS NULL OR btrim("targetTable") <> ''),
  ADD CONSTRAINT "security_event_target_id_not_blank_check"
    CHECK ("targetId" IS NULL OR btrim("targetId") <> ''),
  ADD CONSTRAINT "security_event_target_table_needs_id_check"
    CHECK ("targetTable" IS NULL OR "targetId" IS NOT NULL);
