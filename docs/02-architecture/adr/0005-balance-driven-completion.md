# ADR-0005 — Accounts complete on balance, not day count

**Status:** Accepted · 2026-09-12

## Context

The source document (PDF §13) says an account runs for "100 collection days" and that on reaching the 100th valid day the status becomes Completed.

It does not say what happens when a customer underpays — and §11 establishes that underpayment is routine enough to warrant its own alert. If a customer pays ₹80 instead of ₹100 on some days, they have not repaid the account by day 100.

This is the central unresolved question in the source document. Every other money rule depends on the answer.

## Decision

**An account completes when `total collected ≥ account amount`.** The term is a target, not a limit.

- Shortfalls extend the account past day 100; it stays `ACTIVE` and collection continues
- An account past its target date with outstanding remaining is flagged `isOverdue` — a flag on `ACTIVE`, not a separate status
- Overpayments finish it early; remaining schedule slots are cancelled
- The target completion date is recomputed after every collection (BR-06)

## Consequences

**Good**

- One concept. "Outstanding" always means the same thing, from day 1 to day 130
- One workflow. There is no arrears process, no second collection mechanism, no handoff between them
- The customer's obligation matches reality: they owe the account amount, and they pay until it is cleared
- The ledger is simple — receivable decreases as cash arrives, and reaches zero exactly when the account completes

**Bad**

- "100 days" stops being a promise, which the business must be comfortable communicating to customers
- The schedule's uncollected tail must be regenerated as variance accrues, rather than being fixed at creation
- Reporting needs an overdue view, because accounts no longer disappear on a known date ([M12](../../01-product/modules/M12-reports.md))

**Neutral**

- Field behaviour is unchanged: the Junior still collects the daily amount, and the customer still pays ₹100 a day

## Alternatives considered

**Hard 100 days, shortfall becomes arrears.** Rejected. Closing the account on day 100 with ₹500 outstanding creates a second debt object for what is plainly the same debt — needing its own workflow, its own reporting, its own alerts and its own collection process. Two concepts where one suffices, and the ₹500 is no less owed for having been reclassified.

**100 slots, shortfall redistributed across remaining days.** Rejected on field usability, not arithmetic. It keeps the end date fixed by making the daily amount drift — ₹100 becomes ₹100.51, then ₹101.30. The Junior and the customer both rely on a fixed, memorable figure, and a moving one invites disputes at the door every day (BR-10).

**Per-account configurable policy.** Rejected as false flexibility. It doubles the test surface and the reasoning burden for a business that runs one way.
