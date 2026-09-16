-- Business codes, settings and holidays unique per organization (ADR-0012).
--
-- Organization sign-up makes more than one organization real, so a code one
-- business chose must not block another. Each rebuilt index is the old
-- column list led by "organizationId"; a global duplicate was already
-- impossible, so no existing row can violate the narrower rule.
--
-- customer_code_seq and account_code_seq stay shared: their codes remain
-- unique everywhere, which costs nothing.

-- Sector and line codes (US-010, US-011, LN-07 now reads "per organization").
DROP INDEX "sector_code_key";
CREATE UNIQUE INDEX "sector_organizationId_code_key"
  ON "sector"("organizationId", "code");

DROP INDEX "line_code_key";
CREATE UNIQUE INDEX "line_organizationId_code_key"
  ON "line"("organizationId", "code");

-- Runtime settings (M15).
DROP INDEX "setting_key_key";
CREATE UNIQUE INDEX "setting_organizationId_key_key"
  ON "setting"("organizationId", "key");

-- One business-wide holiday per date, per organization (BR-02). Still
-- NULLS NOT DISTINCT, as constraints_platform built it; Prisma cannot express
-- the clause and does not diff it.
DROP INDEX "holiday_date_sectorId_key";
CREATE UNIQUE INDEX "holiday_organizationId_date_sectorId_key"
  ON "holiday"("organizationId", "date", "sectorId") NULLS NOT DISTINCT;
