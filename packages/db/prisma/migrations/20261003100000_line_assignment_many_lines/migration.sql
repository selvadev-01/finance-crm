-- A Senior or Junior may work several lines at once (decided 2026-10-03).
-- Replaces "one current line per staff member" with "one open assignment per
-- staff member and line": a person is on a line once, however many lines they
-- are on. "One current Senior per line" is unchanged.

DROP INDEX "line_assignment_current_staff_key";

CREATE UNIQUE INDEX "line_assignment_current_staff_line_key" ON "line_assignment"("staffProfileId", "lineId") WHERE ("effectiveTo" IS NULL);
