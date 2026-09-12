# M06 — Working Calendar

**Purpose:** decide which dates are collection days, and do arithmetic on them.

**Source:** PDF §13. Rules: BR-02, BR-03, BR-12.

---

## Why this is its own module

Working-day arithmetic looks like a helper function. It is load-bearing for every date in the system: schedule generation, target completion, missed-collection detection, day close, and every dashboard's notion of "today".

> **This is the quiet risk in the project.** An off-by-one in working-day counting does not crash anything — it silently produces wrong completion dates for every account created that day, and nobody notices for weeks. It is specified as a pure library with exhaustive tests, built early and independently, rather than as a private helper inside M05.

---

## Scope

**In:** the working-day predicate, holiday management, working-day arithmetic (next, add, count, range), business-date resolution.

**Out:** schedule generation (M05 — consumes this module).

---

## Owned entities

`holiday`

---

## Rules

**A working day is any date that is not a Sunday and not a declared holiday.**

| Rule | Detail |
| --- | --- |
| Sundays | Excluded permanently by rule, **never stored as holiday rows** |
| Holidays | Per sector, or business-wide when `sectorId` is null |
| Declaration window | Future dates only |
| Retroactive declaration | Blocked — it would invalidate alerts already raised and reopen settled days |

> Holidays are absent from the source document, which mentions only Sundays. They are added because a daily-collection business in India does not collect on major festival days — and without them, every such day raises a false `MISSED` alert for every customer on every line simultaneously. That is the kind of false alarm that teaches Seniors to ignore alerts.
>
> Per-sector scope exists because local festival closures differ across regions; a single business-wide calendar would be wrong for at least one sector.

---

## Interface

A pure, framework-free library in `packages/domain`. No database access, no Nest imports — holidays are passed in.

| Function | Purpose |
| --- | --- |
| `isWorkingDay(date, holidays)` | The predicate |
| `nextWorkingDay(date, holidays)` | First working day strictly after |
| `addWorkingDays(date, n, holidays)` | The `n`-th working day after |
| `countWorkingDays(from, to, holidays)` | Inclusive count |
| `workingDayRange(from, count, holidays)` | Generate `count` consecutive working dates |
| `toBusinessDate(instant)` | `DATE(instant AT TIME ZONE 'Asia/Kolkata')` |

All dates are calendar dates with no time component, except `toBusinessDate`, which converts an instant.

> Framework-free is the point: these functions can be tested exhaustively — every day of the week, every boundary, leap years, long holiday runs, month and year crossings — in milliseconds, without a database or an application context. That is what makes exhaustive coverage realistic rather than aspirational.

---

## Business date resolution

`businessDate = DATE(capturedAt AT TIME ZONE 'Asia/Kolkata')`, computed once and **stored** (BR-12).

> A collection at 05:10 IST is 23:40 UTC **the previous day**. Grouping by UTC date would silently move that morning's collection into yesterday's tally, and the line would fail to balance for reasons nobody could see from the screen. Storing the value also makes it indexable and immune to a future timezone policy change.

---

## Holiday declaration side effects

Declaring a holiday emits `holiday.declared`, and M05 shifts every affected `PENDING` slot forward. Collected slots are never touched. Affected customers' target completion dates move out by the number of working days lost.

Staff on affected lines are notified, since a declared holiday changes tomorrow's route.

---

## Operations

| Operation | Actor |
| --- | --- |
| Declare holiday | Admin+ (open question 1) |
| Remove a future holiday | Admin+ — triggers schedule regeneration |
| List holidays | All roles |

---

## Testing

The most heavily tested module in the system, and cheap to test because it is pure:

- Every weekday as a start date
- Sunday boundaries in both directions
- Consecutive holidays, holidays adjacent to Sundays
- Month, quarter and year crossings; leap years
- A full 100-day schedule verified against a hand-computed calendar
- Business-date conversion across the IST/UTC day boundary in both directions
- Property test: `countWorkingDays(d, addWorkingDays(d, n)) === n` for all `n`

---

## Risks

| Risk | Mitigation |
| --- | --- |
| Off-by-one in day counting | Property-based tests plus a hand-verified 100-day fixture |
| Timezone handling drifts into other modules | `toBusinessDate` is the only conversion point; reviewed as a rule |
| Holiday declared after schedules are generated | Explicit regeneration path with notification |
| DST | India observes none — but the implementation uses a real timezone library rather than a fixed offset, so this is not a latent assumption |
