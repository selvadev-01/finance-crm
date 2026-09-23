# ADR-0017 — Weekly and monthly collection, anchored in calendar time

**Status:** Accepted · **Date:** 2026-09-23 · **Revises:** [BR-04](../../01-product/business-rules.md#br-04--schedule-generation) and [BR-02](../../01-product/business-rules.md#br-02--working-days)'s holiday shift

## Context

Rasi is a daily-collection business, and every part of the schedule assumed it: `generateSchedule` laid `min(D, remaining)` on **consecutive working days**, `termDays` meant days, and the column that carries the instalment is called `dailyAmount`. The owner asked for accounts that are collected weekly or monthly as well, calculated from that choice.

Three things had to be decided, and each of them is expensive to change once accounts exist.

1. **What `N` means at a cadence that is not daily.** The Admin enters a term next to the instalment amount, and BR-01 checks `D × N ≥ A`.
2. **Where a weekly or monthly visit falls**, and what a Sunday or a declared holiday does to it.
3. **Whether the existing `dailyAmount` column and every caller of the schedule should be renamed.**

## Decision

### `N` counts instalments, not calendar days

A term of 20 on a weekly account means **20 visits**, and the form labels the field "Term (weeks)". Under `DAILY` that is days, which is what it already meant, so no stored row changed meaning and no migration had to backfill.

This keeps BR-01's `D × N ≥ A` and BR-07's `min(D, remaining)` the same calculation at every cadence — including the CHECK constraint `account_loan_term_clears_account_check`, which was not touched. The alternative, keeping `N` in days and deriving the instalment count as `N ÷ 7`, would have made the money rule cadence-dependent and forced an Admin to type 140 to mean 20 weeks.

### Every anchor is measured from day 0, and a holiday moves one visit

The `i`-th instalment falls `i` periods after day 0: `i` working days, `7 × i` calendar days, or `i` calendar months clamped to the month's last day. An anchor landing on a Sunday or a declared holiday **moves forward to the next working day (BR-02), while the anchors after it are still measured from day 0.**

The consequence is that the cadence never drifts. A customer collected on Wednesdays stays on Wednesdays: a holiday moves one visit to the Thursday and the next is Wednesday again. Month-end clamping works the same way, which is why `addCalendarMonths` is documented to take the series base and an index rather than being stepped — stepping a 31st through February gives 28 February and then 28 March for ever after.

Measuring from day 0 is also what makes a **regenerated tail** (BR-06) right. `after` is the date the money moved, so a weekly customer's next visit is a week later. Anchoring on "the next working day" instead would have put every weekly account back on tomorrow's route after each collection.

**The holiday shift now follows the cadence** ([M06](../../01-product/modules/M06-working-calendar.md)). A daily schedule is an unbroken run, so losing a day pushes every slot after it and removing the holiday puts them back. A weekly or monthly schedule has weeks or months of gap around each visit, so only the visit on the holiday moves — and removing the holiday moves nothing, because the anchor never changed and the customer has already been told the new date. Pulling a rescheduled visit back would be the surprising behaviour, not the consistent one.

### `frequency` is required, with no default

`ScheduleInput.frequency` has no default anywhere in `packages/domain`. A default is the dangerous option here: a tail regenerated at the wrong cadence puts a weekly customer back on a daily round, and nothing fails until a Junior arrives at the wrong door on the wrong day. Making it required turned that into a compile error at every call site, which is how the settlement path, the disbursement-day regeneration and the mid-term planner were each found.

The **contract** field does default to `DAILY`, because there the default is doing the opposite job: it keeps every caller written before this existed behaving exactly as it did.

### `dailyAmount` keeps its name

The column, the contract field and the `ScheduleInput` key stay `dailyAmount`, documented as "`D`, one instalment at `collectionFrequency`". Only the labels the Admin reads change — "Weekly amount (₹)", "Term (weeks)" — through `apps/web/lib/cadence.ts`.

Renaming would have meant a column rename plus edits across roughly twenty-five services, tests and fixtures **in the money path**, to buy a better name. The cost is a name that reads oddly for a weekly account; the comment at the column and at the interface carries the meaning. This is revisitable at any time, which is exactly why it was not done now.

### The cadence is immutable after disbursement

Enforced by the trigger `account_loan_frequency_immutable`, beside the existing one for `A` and `I`. Changing it would move every remaining visit on an account whose dates the customer already holds on paper. It remains correctable while `PENDING`, like the other terms.

## Consequences

- Daily accounts behave **identically** — `collectionDueDates` delegates to `workingDayRange` for `DAILY`, and the existing 100-day worked-example specs pass unchanged.
- The enum is written out in both `@repo/domain` and `@repo/contracts`. Neither may import the other (contracts may depend only on zod, the domain only on decimal.js and date utilities), so `apps/api` — the first package that sees both — pins them together in `test/accounts/collection-frequency.spec.ts`.
- The Junior's route, day close and the overdue flag needed no change: the route is built from `account_schedule.dueDate`, and overdue is defined against `targetCompletionDate`. A weekly customer simply does not appear on days they are not due.
- **Not addressed:** the seed dataset is still entirely daily, and no dashboard or report distinguishes the cadences. Neither was asked for, and both are additive.
