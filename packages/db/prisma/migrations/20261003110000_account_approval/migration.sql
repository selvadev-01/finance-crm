-- A Senior may open an account for a customer on their own lines, which waits
-- for an Admin or the Super Admin to approve it before the Super Admin can
-- disburse it (decided 2026-10-03). An Admin's account is approved as it is
-- created.

ALTER TABLE "account_loan" ADD COLUMN "approvedAt" TIMESTAMPTZ(3),
ADD COLUMN "approvedByUserId" TEXT;

-- Every account before this was opened by an Admin or the Super Admin, so it
-- was approved when it was created.
UPDATE "account_loan"
SET "approvedAt" = "createdAt", "approvedByUserId" = "createdByUserId";

-- Money moves only on an approved account: anything past PENDING was
-- approved.
ALTER TABLE "account_loan"
  ADD CONSTRAINT "account_loan_approved_before_disbursement_check"
    CHECK ("status" = 'PENDING'::"AccountStatus" OR "approvedAt" IS NOT NULL);
