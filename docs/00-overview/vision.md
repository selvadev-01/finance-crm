# Vision

## The problem

The business runs daily-collection lending: a customer is given cash today and repays a fixed small amount every day for roughly a hundred days. It works at scale — more than 1,000 active customers, more than 10 collection lines, several sectors — and it is currently run on a Google Sheet.

At this scale the spreadsheet has stopped being a tool and started being the constraint:

- **Nobody can answer "where is my money right now."** Cash moves from customer → Junior → Senior → Admin every single day, and the sheet records only the first hop. The rest is trust and memory.
- **Assignments are invisible.** Which Junior is on which line this week, and which customers moved with them, is not reliably recorded — so line-level performance cannot be attributed to anyone.
- **Shortfalls go unnoticed.** A customer paying ₹80 instead of ₹100 is a signal. Across 1,000 customers, that signal is invisible in a spreadsheet until it has compounded into a bad account.
- **Completion is computed by hand.** "100 collection days, excluding Sundays" is a calendar calculation repeated a thousand times, manually, with no consistency.
- **There is no audit trail.** A cell can be changed by anyone, at any time, with no record of who or when. In a cash business this is the single largest risk.

## What Rasi is

A single application that owns the full lifecycle of a daily-collection account — from customer onboarding, through disbursement, through every daily collection, to completion — and the cash chain that runs alongside it.

Rasi's central claim is **money correctness**. Every rupee that enters the system is attributable to a customer, a collector, a line, a date and a ledger entry, and no recorded figure can be silently altered.

## Principles

**The four roles stay simple.** From the source document: _the Junior collects, the Senior monitors, the Admin manages, the Super Admin controls._ Each role sees only what its job requires. A Junior's screen should be usable while standing at a customer's door — a route list and an amount field, and very little else.

**The field never waits for a network.** Juniors work in areas with unreliable signal. Recording a collection must always succeed immediately and locally; synchronisation is the application's problem, not the collector's. Nothing in the design may assume connectivity at the moment of collection.

**Corrections are additions, never edits.** Collections are append-only. Fixing a mistake creates a new, approved, adjusting record that references the original. The history of what was recorded is as important as the current balance.

**Derived figures are never typed in.** Profit, outstanding, completion dates and every dashboard total are computed from the underlying records. Nobody enters a total by hand, because a hand-entered total is a number that can disagree with reality.

**One timezone, decided once.** All business dates are `Asia/Kolkata`. A collection at 23:40 belongs to that day. Getting this wrong once poisons every daily figure in the system, so it is settled in the data model rather than left to each query.

## What success looks like

- The Super Admin opens one screen in the morning and knows yesterday's expected, collected, shortfall and surplus across every sector — without asking anyone.
- A Senior is alerted the moment a customer on their line underpays, not at month end.
- A Junior finishes a route with no signal and the day's collections are intact and synced by evening.
- Every rupee of cash has a recorded chain of custody from customer to business.
- Account completion happens automatically, on the correct date, without anyone counting days.

## Deliberately not in v1

The first version replaces the spreadsheet and controls the cash. It is not yet a lending platform.

Out of scope, with the reasoning:

| Excluded                             | Why                                                                                                           |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------- |
| Customer-facing app or portal        | Customers are not users. The relationship is in person, daily, by design.                                     |
| Credit scoring or automated approval | Lending decisions stay human. Rasi records them; it does not make them.                                       |
| Online payments / UPI collection     | The business is cash. Digital collection changes the cash-control model entirely and deserves its own design. |
| Accounting-package integration       | The internal ledger must be trustworthy first. Exporting to Tally is a later conversation.                    |
| Multi-business tenancy               | Organizations are separate and each owner signs up with a setup key ([ADR-0012](../02-architecture/adr/0012-organization-sign-up.md)). No billing, plans or cross-organization administration. |

Deferred to Phase 2 and tracked in the roadmap: Tamil language support, GPS and photo proof-of-visit, SMS/WhatsApp receipts to customers, and Excel/PDF report export.

> **How the data gets in.** There is no exportable dataset behind the current spreadsheet, so there is no import to build and none is planned. Customers are onboarded by hand through the standard flow, and development runs entirely on seeded data.
>
> That makes launch a **data-entry exercise**: 1,000+ customers, each with a profile, a reference person and a mid-term account, typed in once under time pressure. The consequence for the build is that the onboarding and account-creation forms are throughput-critical, not merely correct.
