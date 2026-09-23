-- BR-04: an account's instalments may fall due daily, weekly or monthly.
--
-- DAILY is the default, so every existing row keeps exactly the behaviour it
-- had: `termDays` already counts instalments, which for a daily account is
-- days, and BR-01's `D * N >= A` check in constraints_account_loan holds
-- unchanged at every cadence.

CREATE TYPE "CollectionFrequency" AS ENUM ('DAILY', 'WEEKLY', 'MONTHLY');

ALTER TABLE "account_loan"
  ADD COLUMN "collectionFrequency" "CollectionFrequency" NOT NULL DEFAULT 'DAILY';
