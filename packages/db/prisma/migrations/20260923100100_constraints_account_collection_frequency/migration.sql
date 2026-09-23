-- The cadence is immutable after disbursement, for the same reason A and I are
-- (constraints_account_lifecycle): changing it would re-lay every remaining
-- slot at a different spacing on an account the customer has already been told
-- the dates for. While the account is still PENDING the terms may be corrected.

CREATE FUNCTION "account_loan_reject_frequency_change"()
RETURNS trigger
LANGUAGE plpgsql
SET search_path FROM CURRENT
AS $$
BEGIN
  IF OLD."status" <> 'PENDING'
     AND NEW."collectionFrequency" IS DISTINCT FROM OLD."collectionFrequency" THEN
    RAISE EXCEPTION
      'account_loan_frequency_immutable: account % is %; collectionFrequency cannot change after disbursement',
      OLD."id", OLD."status";
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "account_loan_frequency_immutable"
  BEFORE UPDATE OF "collectionFrequency" ON "account_loan"
  FOR EACH ROW
  EXECUTE FUNCTION "account_loan_reject_frequency_change"();
