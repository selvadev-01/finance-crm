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

| Rule                    | Detail                                                                      |
| ----------------------- | --------------------------------------------------------------------------- |
| Sundays                 | Excluded permanently by rule, **never stored as holiday rows**              |
| Holidays                | Per sector, or business-wide when `sectorId` is null                        |
| Declaration window      | Future dates only                                                           |
| Retroactive declaration | Blocked — it would invalidate alerts already raised and reopen settled days |

> Holidays are absent from the source document, which mentions only Sundays. They are added because a daily-collection business in India does not collect on major festival days — and without them, every such day raises a false `MISSED` alert for every customer on every line simultaneously. That is the kind of false alarm that teaches Seniors to ignore alerts.
>
> Per-sector scope exists because local festival closures differ across regions; a single business-wide calendar would be wrong for at least one sector.

---

## Interface

A pure, framework-free library in `packages/domain` (`src/calendar/`). No database access, no Nest imports — holidays are passed in.

| Function                                 | Purpose                                                          |
| ---------------------------------------- | ---------------------------------------------------------------- |
| `isWorkingDay(date, holidays)`           | The predicate                                                    |
| `nextWorkingDay(date, holidays)`         | First working day strictly after                                 |
| `addWorkingDays(date, n, holidays)`      | The `n`-th working day after; `n = 0` returns `date`             |
| `countWorkingDays(from, to, holidays)`   | Working days in `(from, to]` — after `from`, up to and incl `to` |
| `workingDayRange(from, count, holidays)` | The `count` consecutive working dates after `from`               |
| `toBusinessDate(instant)`                | `DATE(instant AT TIME ZONE 'Asia/Kolkata')`                      |

**Dates are `CalendarDate`** — a branded `"YYYY-MM-DD"` string, not a JS `Date`, so no conversion can shift a day. It is created by `parseCalendarDate` (which rejects dates that do not exist), by `fromUtcMidnight` when reading a `@db.Date` column (which refuses anything but 00:00 UTC, so a `timestamptz` cannot be truncated into a date), or by `toBusinessDate`. `toUtcMidnight` writes one back.

**Every function counts from the day after its start date.** The start date is day 0 — for an account, the disbursement date, which is never a collection day (BR-03). So `workingDayRange(disbursementDate, slots, holidays)` gives an account's collection days, and `countWorkingDays(disbursementDate, lastSlot, holidays)` is the slot count.

> ⚠️ **Corrected during implementation.** This table previously called `countWorkingDays` an _inclusive_ count, while the testing section required `countWorkingDays(d, addWorkingDays(d, n)) === n`. Both cannot hold: when `d` is a working day an inclusive count gives `n + 1`. The half-open range was chosen because it satisfies the property for every `d` and matches BR-03's day-0 convention.

**`holidays` is a set already resolved for one sector** — business-wide rows plus that sector's own. Resolving scope belongs to the caller; the arithmetic never sees a `sectorId`.

Negative or non-integer counts, and a `to` before `from`, throw `RangeError` rather than returning a plausible number.

> Framework-free is the point: these functions can be tested exhaustively — every day of the week, every boundary, leap years, long holiday runs, month and year crossings — in milliseconds, without a database or an application context. That is what makes exhaustive coverage realistic rather than aspirational.

---

## Business date resolution

`businessDate = DATE(capturedAt AT TIME ZONE 'Asia/Kolkata')`, computed once and **stored** (BR-12).

> A collection at 05:10 IST is 23:40 UTC **the previous day**. Grouping by UTC date would silently move that morning's collection into yesterday's tally, and the line would fail to balance for reasons nobody could see from the screen. Storing the value also makes it indexable and immune to a future timezone policy change.

---

## Holiday declaration side effects

Declaring a holiday shifts every affected `PENDING` slot forward, in the declaring transaction (as built: a direct call, not a `holiday.declared` event — see [As built](#as-built--holidays-us-093-2026-09-17)). Collected slots are never touched. Affected customers' target completion dates move out by the number of working days lost.

Staff on affected lines are notified, since a declared holiday changes tomorrow's route.

---

## Operations

| Operation               | Actor                                                                         |
| ----------------------- | ----------------------------------------------------------------------------- |
| Declare holiday         | Admin+ (open question 1)                                                      |
| Remove a future holiday | Admin+ — triggers schedule regeneration                                       |
| List holidays           | All roles — Seniors and Juniors see business-wide and their own line's sector |

---

## As built — holidays (US-093, 2026-09-17)

In `apps/api/src/calendar/` (`HolidayService`, `HolidayController`), `packages/domain/src/schedule/holiday-shift.ts` and `apps/web/app/(console)/settings/holidays/`. Status is in the [backlog](../../06-delivery/backlog.md).

- **Routes.** `GET /api/holidays` (`holiday.view`, every role): `period=upcoming` (default; today onwards, soonest first) or `past` (before today, latest first), optional `year`, cursor paging on `(date, id)`. Each row carries its sector (or null for business-wide), who added it, and `removable` (date after today). `POST /api/holidays` and `DELETE /api/holidays/:holidayId` (`holiday.declare`, Admin and Super Admin) return the holiday with `accountsShifted`. Out of scope is `404` ([M02](M02-access-control.md)): a Senior or Junior sees business-wide holidays and their current line's sector's, and nothing without a current line.
- **Rules decided.**
  - _Future dates only, both ways._ A date on or before today's business date (`toBusinessDate`) is `422 HOLIDAY_NOT_IN_FUTURE` with a `date` detail, for declaring and for removing. Today counts as past: the day is under way. Past holidays are never changed or deleted.
  - _Not a Sunday._ `422 HOLIDAY_ON_SUNDAY`; the database refuses it too (`holiday_not_sunday_check`).
  - _One per scope and date._ The same date twice business-wide, or twice for one sector, is `409 HOLIDAY_EXISTS` with a `date` detail naming the existing holiday. A sector holiday on a business-wide holiday's date is allowed, as the unique index allows it; it moves nothing, and removing one of the two leaves the other in force.
  - _Sector._ An inactive sector is `422 SECTOR_INACTIVE`; a sector outside the organization `404 SECTOR_NOT_FOUND`. A blank `sectorId` means business-wide.
  - _Removal is a delete_, audited `DELETE` with the holiday as `before`. Declaring is audited `CREATE` with `accountsShifted`. Individual accounts' date changes are not audited, as a schedule regeneration after a collection is not.
- **Schedules follow, in the same transaction** (BR-02, US-034). `shiftForHolidayChange` takes an account's `PENDING` slots and lays every one due on or after the date again on consecutive working days from the first working day on or after it (never on or before disbursement), with the sector's holidays after the change. Sequences and amounts are kept, answered slots and balances never change, and only slots whose date changes are written (one `UPDATE … FROM (VALUES …)` per 2,000). The account's `targetCompletionDate` becomes its last slot's date, and `firstCollectionDate` moves when slot 1 moves. Covered accounts are `PENDING` and `ACTIVE` accounts whose customer is in the sector (or any, business-wide): on declaring, those with a pending slot on the date; on removing, those disbursed before it with a pending slot after it. A domain property test holds that the shifted schedule is exactly the one generated with the holiday known, and that declaring then removing restores every date.
- **Concurrency.** Holiday changes lock the organization row, so two never interleave. Covered accounts are locked in id order before their slots are read, and the set is re-read until it stops growing, so a collection settling one of them either finished first or waits and then sees the new holiday. A business-wide change gets a 60-second transaction.
- **Notices.** `HOLIDAY_DECLARED` / `HOLIDAY_REMOVED` (`WARNING`, so pushed) to the Seniors and Juniors assigned today to the active lines covered ([M10](M10-notifications.md#as-built)); not to the Admin who made the change.
- **Web.** `/settings/holidays` (S-27), in the System group for every console role: an upcoming/past switch kept in the URL, Date, Day, Name, Applies to, Added by; "Add holiday" (date, name, applies to) and a per-row "Remove" for future holidays, both Admin and Super Admin only, with the API's refusals at the field; the toast says how many accounts' schedules moved.

**Tests.** Domain: US-034 worked example both ways, Sunday neighbours, a run of holidays, overlapping scopes, the disbursement anchor, and three fast-check properties. Tier 1 `test/calendar/holiday.service.spec.ts`: the US-034 scenarios against real disbursed accounts (the 15 January slot and every later one move a working day, target 27 → 28 January, the collected slot and the balance unchanged; removing restores them; closing the holiday marks nothing `MISSED` and raises no alert), sector scoping, a pending account's first collection date, every refusal, list order, paging and Senior/Junior scope, audit rows and notices. HTTP `test/holidays.e2e-spec.ts` and the RBAC matrix cover the three routes; Tier 2 declares holidays only in a tagged organization with no accounts, and `deleteTestRunData` removes them. Constraint specs cover both CHECKs.

**Not built:** a Junior-side list of upcoming holidays (the route only says "Today is a holiday"), editing a holiday's name (remove and declare again).

---

## Testing

The most heavily tested module in the system, and cheap to test because it is pure:

- Every weekday as a start date
- Sunday boundaries in both directions
- Consecutive holidays, holidays adjacent to Sundays
- Month, quarter and year crossings; leap years
- A full 100-day schedule verified against a hand-computed calendar
- Business-date conversion across the IST/UTC day boundary in both directions — **run under a foreign `TZ`**, because on a machine set to IST a conversion that ignores the timezone passes by accident
- Property test: `countWorkingDays(d, addWorkingDays(d, n)) === n` for all `n`

`countWorkingDays` is computed in closed form and `addWorkingDays` by stepping, so the property test checks two independent algorithms against each other rather than one against itself. The properties run under fast-check over 1990–2100; an exhaustive pass also checks every start date from 2024 to 2028 against a holiday set with runs, Sunday neighbours and year-end dates.

---

## Risks

| Risk                                           | Mitigation                                                                                                                               |
| ---------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Off-by-one in day counting                     | Property-based tests plus a hand-verified 100-day fixture                                                                                |
| Timezone handling drifts into other modules    | `toBusinessDate` is the only conversion point; reviewed as a rule                                                                        |
| Holiday declared after schedules are generated | Explicit regeneration path with notification                                                                                             |
| DST                                            | India observes none — but the implementation uses a real timezone library rather than a fixed offset, so this is not a latent assumption |
