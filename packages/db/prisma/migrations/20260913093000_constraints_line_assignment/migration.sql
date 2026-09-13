-- Temporal staffing invariants (M03, BR-15, data-dictionary.md).

ALTER TABLE "line_assignment"
  ADD CONSTRAINT "line_assignment_effective_range_check"
    CHECK ("effectiveTo" IS NULL OR "effectiveTo" >= "effectiveFrom");

-- One current Senior per line; one current line per staff member. Declared in
-- schema.prisma (partialIndexes preview); SQL as `prisma migrate diff`
-- generates it.
CREATE UNIQUE INDEX "line_assignment_current_senior_key" ON "line_assignment"("lineId") WHERE ("assignmentRole" = 'SENIOR'::"AssignmentRole") AND ("effectiveTo" IS NULL);
CREATE UNIQUE INDEX "line_assignment_current_staff_key" ON "line_assignment"("staffProfileId") WHERE ("effectiveTo" IS NULL);
