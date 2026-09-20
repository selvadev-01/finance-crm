-- Temporal line membership invariants (US-023, M04, BR-15).

ALTER TABLE "customer_line_period"
  ADD CONSTRAINT "customer_line_period_effective_range_check"
    CHECK ("effectiveTo" IS NULL OR "effectiveTo" >= "effectiveFrom");

-- One current line per customer. Declared in schema.prisma (partialIndexes
-- preview) and created with the table, so nothing to add here.
