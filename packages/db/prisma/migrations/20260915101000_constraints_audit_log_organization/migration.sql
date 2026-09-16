-- US-090: every audit entry except a sign-in attempt names its organization,
-- so nothing new can fall outside the scoped log.
--
-- NOT VALID: enforced for every new row, not checked against the rows written
-- before the column existed, which stay null because audit_log rejects UPDATE.
-- A LOGIN may have none: an attempt with an unknown email matches no staff.

ALTER TABLE "audit_log"
  ADD CONSTRAINT "audit_log_organization_check"
  CHECK ("organizationId" IS NOT NULL OR "action" = 'LOGIN')
  NOT VALID;
