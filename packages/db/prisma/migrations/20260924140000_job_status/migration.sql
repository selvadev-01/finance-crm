-- M14: the latest run of each scheduled job, per organization, so Admins can
-- see whether the nightly work ran and when a job last failed for good.
-- Decided 2026-09-24: one row per (organization, job), not a row per run —
-- two jobs run every minute.

-- CreateTable
CREATE TABLE "job_status" (
    "organizationId" TEXT NOT NULL,
    "job" TEXT NOT NULL,
    "lastStartedAt" TIMESTAMPTZ(3) NOT NULL,
    "lastFinishedAt" TIMESTAMPTZ(3),
    "lastOutcome" TEXT NOT NULL,
    "lastError" TEXT,
    "lastSucceededAt" TIMESTAMPTZ(3),
    "deadLetteredAt" TIMESTAMPTZ(3),
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "job_status_pkey" PRIMARY KEY ("organizationId","job")
);

-- AddForeignKey
ALTER TABLE "job_status" ADD CONSTRAINT "job_status_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- An attempt is running, or it ended one way or the other.
ALTER TABLE "job_status"
  ADD CONSTRAINT "job_status_outcome_check"
    CHECK ("lastOutcome" IN ('RUNNING', 'SUCCEEDED', 'FAILED'));
