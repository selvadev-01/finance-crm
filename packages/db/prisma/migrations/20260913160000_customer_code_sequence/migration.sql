-- US-020: customer codes (CUS-00001, …) are issued by the API from this
-- sequence (decided 2026-09-13), so concurrent onboarding never collides and
-- no Admin retypes a number. Values are not reused: a create that rolls back
-- leaves a gap, which is harmless — the code identifies, it does not count.
CREATE SEQUENCE "customer_code_seq" AS integer START WITH 1 MINVALUE 1 NO CYCLE;
