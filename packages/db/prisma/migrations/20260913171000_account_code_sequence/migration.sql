-- US-030: account codes (ACC-2026-00001, …) are issued by the API. The number
-- comes from this sequence and never restarts; the year is the business date
-- the account was created. A rolled-back create leaves a gap, which is
-- harmless — the code identifies, it does not count.
CREATE SEQUENCE "account_code_seq" AS integer START WITH 1 MINVALUE 1 NO CYCLE;
