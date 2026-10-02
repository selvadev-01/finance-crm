-- ADR-0012: the sign-up rate limit was counted in process memory, so two API
-- processes each allowed the limit and a restart forgot it. The counter now
-- lives here, one row per limiter key, shared by every process.

-- CreateTable
CREATE TABLE "rate_limit_window" (
    "key" TEXT NOT NULL,
    "windowStart" TIMESTAMPTZ(3) NOT NULL,
    "count" INTEGER NOT NULL,
    CONSTRAINT "rate_limit_window_pkey" PRIMARY KEY ("key")
);

-- A window exists because an attempt opened it.
ALTER TABLE "rate_limit_window"
  ADD CONSTRAINT "rate_limit_window_count_positive_check"
    CHECK ("count" >= 1);
