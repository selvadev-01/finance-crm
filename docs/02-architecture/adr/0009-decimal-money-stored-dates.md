# ADR-0009 — Decimal money and stored business dates

**Status:** Accepted · 2026-09-12

## Context

Two representation choices that look like details and are not. Both have the property that getting them wrong produces no error — just quietly wrong numbers, discovered weeks later when a line fails to balance and nobody can say why.

**Money:** JavaScript's default number is an IEEE 754 double. `0.1 + 0.2 !== 0.3`.

**Dates:** the business runs in `Asia/Kolkata` (UTC+5:30). Servers run in UTC. A collection recorded early in the morning IST falls on the *previous* UTC day.

## Decision

**Money is `NUMERIC(14,2)` in Postgres, `Decimal` in Prisma, and a decimal string on the wire.** No `float`, `double` or JS `number` in the money path at any layer, including the frontend.

**Business date is computed once as `DATE(capturedAt AT TIME ZONE 'Asia/Kolkata')` and stored** as a `date` column alongside the `timestamptz` instant. All daily aggregation groups by the stored column, never by a conversion applied at query time.

The timezone is fixed in code, not configurable.

## Consequences

**Good**

- No drift. Across 1,500 collections a day over 100 days, there are 150,000 opportunities for a fraction of a paisa to accumulate — and the ledger's balancing constraint would eventually reject a transaction for reasons nobody could trace to a rounding error months earlier
- The API boundary preserves the guarantee: a decimal string forces the client to choose a decimal type rather than silently parsing into a float
- `businessDate` is indexable, which the line-tally and day-close queries depend on
- A future timezone policy change cannot retroactively rewrite history, because the value was recorded, not derived

**Bad**

- Decimal arithmetic is more verbose than operators. Every calculation goes through a decimal library rather than `+`
- Money cannot be compared or summed with native operators, which is easy to forget and needs a lint rule
- Storing a derived column risks it disagreeing with `capturedAt` if written by a path that bypasses the conversion helper — mitigated by a single conversion point in [M06](../../01-product/modules/M06-working-calendar.md)

**Neutral**

- `NUMERIC(14,2)` holds up to ₹999,999,999,999.99, far beyond any plausible need, at negligible cost

## Alternatives considered

**Integer paise.** Genuinely viable and a close call. Rejected because every read and write needs a conversion, display code must divide by 100 everywhere, and a single missed conversion is a hundredfold error — a louder failure than drift, but a more likely one. `NUMERIC` keeps the stored value the same as the business value.

**Floating point with rounding at the boundary.** Rejected. Rounding at display does not prevent accumulated drift in stored balances, and the ledger's balancing constraint makes drift fatal rather than cosmetic.

**Money as JSON numbers on the wire.** Rejected. It re-introduces float at the API boundary regardless of what the database stores, and undoes the guarantee at the exact layer where the client is most likely to mishandle it.

**Computing business date at query time.** Rejected. It cannot use an index, it recomputes on every read, and it makes every aggregate depend on a conversion being written identically in every query.

**Configurable timezone.** Rejected. Every date calculation would depend on a database read, and a wrong value would silently misfile every collection in the system.
