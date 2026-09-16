# Screen Specifications

Format from PDF §31: **Page → Purpose → Data → Fields → Actions → Permissions → Status → Calculations → Notifications → Empty State → Error State.**

Seven screens are specified in full — the ones where getting it wrong costs money or loses a collection. The remainder are listed at the end with the pattern they follow.

---

## S-01 · Today's Route (Junior)

**Purpose.** Show the Junior who to visit and what to collect. The only screen they need open all day.

**Data.** Customers with a slot due today, assigned to this Junior, in visiting order. Per account: customer name, address, expected amount, outstanding. Sync status per entry. Offline indicator and unsynced count.

**Fields.** None — read-only. Entry happens in S-02.

**Actions.** Tap a customer row → S-02 · Refresh route · Tap unsynced badge → S-03 · Tap bell → notifications.

**Permissions.** Junior only. Scoped to assigned customers on their current line. **No invested amount or profit anywhere on this screen.**

**Status.** Per row: `Pending` (not yet collected today) · `Saved on device` · `Syncing` · `Synced`.

**Calculations.** `expected = min(dailyAmount, outstanding)` (BR-07). Outstanding reflects locally queued collections optimistically.

**Notifications.** None raised here.

**Empty state.** Three distinct messages, never collapsed into one:

- Sunday — "No collections on Sundays"
- Declared holiday — "Today is a holiday: Deepavali"
- Nothing due — "No collections due today"

**Error state.** Offline is **not an error** — the cached route renders with an offline indicator. A cache older than 72 hours shows a stale-data warning and prompts for connectivity. Sign-in expiry retains the queue and prompts to sign in.

**As built.** Rows in customer-code order — there is no visiting-order model yet. Each account row carries its state (Pending shows nothing; amber "Saved on phone"; spinner "Syncing"; green tick "Sent to office"), and a line under the title says when the route was fetched and whether it includes collections not yet sent. The status bar carries the bell with the unread count (M10, 2026-09-15); it opens `#notifications`, which needs signal.

> **Multi-account customers** (BR-01a) render as a group header with the customer name, and one independently-confirmable row per account beneath. The layout is visibly different from the single-account case, not a subtle variation — a Junior in a hurry must not be able to put a combined payment against the first account.

---

## S-02 · Record Collection (Junior)

**Purpose.** Record what the customer actually paid. The most important interaction in the system.

**Data.** Customer name, address. Per account: expected amount, outstanding, daily amount, days remaining.

**Fields.**

| Field  | Type                    | Default                      | Notes                     |
| ------ | ----------------------- | ---------------------------- | ------------------------- |
| Amount | Decimal, numeric keypad | **Pre-filled with expected** | One per account           |
| Note   | Text, optional          | —                            | For unusual circumstances |

**Actions.** Confirm · Confirm as no payment (records ₹0 with a visit) · Cancel.

**Permissions.** Junior, assigned customers only.

**Status.** On confirm: saved locally in under 100 ms, marked `Saved on device`.

**Calculations.** `variance = amount − expected`. Classification per BR-08 — exact match required for `CORRECT`. Local outstanding decrements immediately.

**Notifications.** On sync, `LOW` / `EXTRA` / `NO_PAYMENT` alerts the Senior (§12). Nothing fires while queued locally.

**Empty state.** Not applicable.

**Error state.**

- Amount exceeds outstanding → rejected, stating the outstanding
- Account completed while offline → rejected on sync, surfaced with an explanation
- Customer reassigned while offline → rejected on scope, surfaced
- **Network failure is not an error** — the entry is queued and confirmed

> The common case is **one tap**: the expected amount is pre-filled, and the Junior confirms. Typing is required only when the amount differs. Optimising for the exception would tax the ninety-percent case dozens of times a day.
>
> "Confirm as no payment" is a separate action rather than typing `0`, because `NO_PAYMENT` and `MISSED` must never be conflated (BR-09) — this button is the Junior asserting they were there.

**As built.** Opened per customer (`/route#collect/:customerId`), one form per account. A typed `0` is refused with a pointer to "No payment — I visited", which confirms in a dialog. The amount is checked on the phone before saving (a plain rupee amount, at most the optimistic outstanding) and again by the server. While typing, the hint says in words how the amount compares with expected. Days remaining is the account's pending slot count from the last route fetch; it does not move for collections still on the phone. After the last pending account of a customer is confirmed, the screen returns to the route with "Saved on phone: ₹… from …".

---

## S-03 · Sync Status (Junior)

**Purpose.** Answer "is my day safe".

**Data.** Unsynced entries with customer, amount, time captured, attempt count, last error. Last successful sync time. Queue depth.

**Fields.** None.

**Actions.** Retry now · Retry one · View entry detail.

**Permissions.** Junior, own queue.

**Status.** Per entry: `Queued` · `Syncing` · `Failed` (with reason).

**Calculations.** None.

**Notifications.** None.

**Empty state.** "Everything is synced" with the last sync time — a reassuring state, not a blank screen.

**Error state.** A permanently failed entry (validation rejection) shows the reason and cannot be retried into success. The server never received it, so no Senior can see it: the Junior removes it from the phone only after confirming, in a dialog naming the amount and customer, that they will hand the money to the office (decision 2026-09-14). A Senior-facing record of refused submissions can come with M10. **Sign-out is blocked while the queue is non-empty**, and refused entries count until removed.

**As built.** Sign-out lives at the foot of this screen, reached from the status bar's count. Sent entries stay listed, collapsed, until pruned after a day or cleared at sign-out.

---

## S-04 · Create Account (Admin)

**Purpose.** Create a loan, with every derived value visible before saving. Amounts are immutable after disbursement, so there is no second chance.

**Data.** Selected customer, their line and sector, and any existing active accounts.

**Fields.**

| Field               | Type    | Default                | Validation                                           |
| ------------------- | ------- | ---------------------- | ---------------------------------------------------- |
| Customer            | Search  | —                      | Required                                             |
| Account amount `A`  | Decimal | —                      | `> 0`                                                |
| Invested amount `I` | Decimal | —                      | `> 0`, **`< A`**                                     |
| Profit `P`          | Decimal | **Derived, read-only** | `A − I`                                              |
| Daily amount `D`    | Decimal | —                      | `> 0`, `≤ A`                                         |
| Term days `N`       | Integer | `100`                  | `> 0`, **`D × N ≥ A`**                               |
| Disbursement date   | Date    | Today                  | **Past dates allowed** — see below                   |
| Collected to date   | Decimal | `0`                    | Only shown when the disbursement date is in the past |

**Actions.** Save as pending · Save and disburse · Cancel.

**Permissions.** Admin and above.

**Status.** `PENDING` until disbursed.

**Calculations — all live as the Admin types:**

- `P = A − I`
- First collection date = next working day after disbursement (BR-03)
- Schedule preview: `N` slots, last absorbing the remainder (BR-04)
- Target completion date

**Notifications.** On disbursement, the Senior is notified of the new account (§12).

**Empty state.** Not applicable.

**Error state.** Each constraint rejects with its reason, not a generic message — "Invested amount must be below the account amount", "₹50 × 100 days cannot clear ₹10,000". Field-level, shown on blur rather than only on submit.

> The schedule preview is the point of this screen. An Admin who can see 100 dated slots summing to exactly ₹10,000, with no Sundays, catches a wrong daily amount before it becomes a hundred wrong expectations.
>
> A customer with an existing active account shows an informational note, not a warning — concurrent accounts are permitted (BR-01a).

### Mid-term accounts

A past disbursement date is a **normal, expected case**, not an edge case. There is no data import, so every customer entered at launch is already partway through their term.

When the disbursement date is in the past, the form additionally asks for **collected to date**, and the preview shows which slots are already behind and what the outstanding and target completion date will be.

> **The collected figure must come from what the customer has actually paid**, taken from their paper collection note — never inferred as `days elapsed × daily amount`. Any customer who ever underpaid will not match that formula, and an account seeded with an inflated collected total will complete early and leave money uncollected.
>
> The form states this next to the field rather than assuming whoever is typing knows it. At launch several people will be entering customers at speed, and this is the one field where a plausible-looking wrong value causes silent, permanent loss.

### Throughput

This form and S-10 are entered 1,000+ times in the launch window. They are **throughput-critical**, not merely correct: keyboard-first with correct tab order, submit-and-create-another without a page reload, inline validation at the field rather than on submit, and sensible defaults carried from the previous entry where safe (line, sector, term days). Three seconds saved per customer is an hour saved across the launch.

---

## S-05 · Day Close (Senior)

**Purpose.** Reconcile the line's day and lock it.

**Data.** Line, business date. Expected total, collected total, shortfall or surplus. Per Junior: collected, entry count, sync status. Every `LOW`, `EXTRA`, `NO_PAYMENT` and `MISSED` entry. Handover status.

**Fields.** None — handovers are S-06.

**Actions.** Close day · View entry · Initiate handover to Admin · Reopen (Admin only).

**Permissions.** Senior on their own line; Admin and above anywhere.

**Status.** `OPEN` → `CLOSED` → `TALLIED`, or `REOPENED`.

**Calculations.** Per BR-16. `TALLIED` requires `discrepancy = 0` and all handovers acknowledged.

**Notifications.** Closing notifies Admin. A discrepancy alerts Admin. An automatic reopen from a late sync notifies the Senior (BR-16a).

**Empty state.** A day with no collections due — Sunday or holiday — shows that rather than zeros.

**Error state.** Closing with unsynced devices **warns and permits**, naming which Juniors have not synced.

> Blocking on unsynced devices would leave lines permanently open whenever a phone is off or out of signal, which is routine. Closing on what is known and reopening when the rest arrives matches how the day actually works.

**As built** at `/lines/:lineId/day-closes/:date`, also reached from the line page and `/cash`: a date picker, expected, collected, shortfall or surplus, cash received with its discrepancy; Juniors with entries, collected and phone state (All sent / Not sent / Not heard from); "Needs a look" listing LOW, EXTRA, NO_PAYMENT, MISSED and not-yet-visited slots; handovers with denominations, Acknowledge and Dispute. The close dialog names the figures and missed slots, then "Close anyway" if phones have not sent everything. Reopen asks for a reason. A Senior hands the day's acknowledged cash to the office from here or `/cash`.

---

## S-06 · Cash Handover

**Purpose.** Move physical cash up the chain with a count both parties can check.

**Data.** Sender, receiver, business date, system-recorded amount for that person and date.

**Fields.**

| Field           | Type        | Notes                               |
| --------------- | ----------- | ----------------------------------- |
| ₹500 … ₹1 count | Integer × 9 | One per denomination                |
| Declared total  | Decimal     | **Computed from counts, read-only** |
| Note            | Text        | Required when a discrepancy exists  |

**Actions.** Submit handover · Acknowledge (receiver) · Dispute (either party).

**Permissions.** Junior → Senior, Senior → Admin. Acknowledgement by the receiver only.

**Status.** `PENDING` → `ACKNOWLEDGED`, or `DISPUTED`.

**Calculations.** `declaredAmount = Σ (denomination × count)`. `discrepancy = declared − system`.

**Notifications.** Submission notifies the receiver. Acknowledgement notifies the sender. A dispute alerts Admin.

**Empty state.** Nothing to hand over — no collections that day.

**Error state.** **A discrepancy does not block submission** — it is recorded and flagged.

> Blocking a short handover would mean the cash never gets recorded as moving, which is the worst outcome: the money has physically changed hands whether or not the system accepts it.

**As built.** The Junior hands over at `/route#handover` (needs signal; warns when collections are still on the phone): one card per line and date still held, nine rows with − / + and a number field, the computed total, "Matches" or "₹20.00 short", a note when it differs, and one submit button to the named Senior. A pending handover shows "waiting for … to acknowledge"; recent handovers show their status and any dispute note. Seniors and Admins acknowledge and dispute on `/cash` and S-05.
>
> The declared total is computed from counts rather than typed, so the count and the total cannot disagree. "One ₹200 note short" is a fact both parties can check while the cash is still in the room; "₹200 short" is an argument.

---

## S-07 · Business Overview (Super Admin)

**Purpose.** Answer "how did we do today" before any interaction.

**Data.** §17's thirteen figures: sectors, lines, customers, active accounts, completed accounts, total account amount, total invested, total profit, today's expected, today's actual, pending, extra, low. Plus sector tally status (§19).

**Fields.** Date selector, defaulting to today.

**Actions.** Drill into any figure · Change date · Export (Phase 2).

**Permissions.** Super Admin; Admin sees the same with settings absent.

**Status.** Live, with the last-updated time shown.

**Calculations.** Rollups along `Customer → Line → Sector → Business` (§23), from ledger-backed values. Line attribution from `collection.lineId` (BR-15).

**Notifications.** None raised here; the bell shows the count.

**Empty state.** Before any data exists, a setup prompt rather than a grid of zeros.

**Error state.** A partial failure renders available figures and marks the rest unavailable — **never renders a zero for a figure it could not compute.**

> A zero and an unknown are different, and conflating them on a money dashboard is how a business concludes it collected nothing today.
>
> §17's thirteen figures are ranked rather than dropped: today's four money figures at full size above the fold on a phone, structural counts second, cumulative totals third. Everything remains on the screen; the order reflects what is asked most often.

---

## Remaining screens

| ID      | Screen                   | Pattern                                                                                               |
| ------- | ------------------------ | ----------------------------------------------------------------------------------------------------- |
| S-08    | Customer list            | Filterable list, role-scoped, search by name/mobile/code                                              |
| S-09    | Customer 360             | Detail with tabs: profile, accounts, history. **Total outstanding labelled as a sum across accounts** |
| S-10    | Create/edit customer     | Form, reference person mandatory, duplicate-mobile warning                                            |
| S-11    | Account detail           | Detail with schedule, collection history, ledger view (Admin+)                                        |
| S-12    | Line list / detail       | List + detail showing §14's figures                                                                   |
| S-13    | Sector list / detail     | As above                                                                                              |
| S-14    | Team list / staff detail | List + detail with assignment history                                                                 |
| S-15    | Assign staff to line     | Form with explicit effective date                                                                     |
| S-16    | Collection list          | Filterable list, date-bounded. **As built** at `/collections`: from/to (default the last 7 days, at most 93), line (Admins), collections and/or corrections; a correction row opens its original                                                                         |
| S-17    | Collection detail        | Detail with adjustments and approval trail. **As built**: recorded amount, the net that stands, expected, outstanding; corrections with reason, requester, decision and note; "Request correction" (Senior) and "Reverse" (Admin) dialogs                                                            |
| S-18    | Pending approvals        | Action queue; **self-approval blocked**. **As built** at `/collections/pending-approval`: the recorded net struck through beside what it becomes, the reason and requester; Approve / Reject dialogs naming the consequence; a request of your own says another approver decides instead of offering buttons                                                               |
| S-19    | Senior line dashboard    | Dashboard, one line                                                                                   |
| S-20    | Admin dashboard          | Dashboard, §21 figures                                                                                |
| S-21    | Notification centre      | Grouped list, deep-linking. **As built** at `/notifications` (console) and `/route#notifications` (Junior, needs signal): grouped by business day, unread marked by a dot and weight, mark read and mark all read, "Notify me on this device" asked only from a tap; the console page also holds category preferences with ALERT locked on. Junior rows do not deep-link, because their links are console pages |
| S-22–26 | Reports                  | Filterable, date-bounded tables                                                                       |
| S-27    | Holidays                 | List + create, future dates only                                                                      |
| S-28    | Settings                 | Form, Super Admin only, audited                                                                       |
| S-29    | Audit log                | Filterable list, read-only. **As built** at `/settings/audit` (Admin, Super Admin): action, record type, record id, staff member and date filters kept in the URL; newest first with time, action, record (linked where a page exists) and who; each entry opens to the before/after, IP address and device; "Older entries" pages. Account history (US-091) is a section on the account page |
| S-30    | Sign in                  | Form; generic failure message                                                                         |

---

## Cross-cutting rules

**Money** is rendered by `formatCurrency` with Indian grouping (₹1,23,456.00) — never `toFixed`.

**Dates** display as `DD MMM YYYY`; business dates never show a time.

**Every list** has loading, empty and error states, and distinguishes _no data yet_ from _no results for this filter_ from _nothing permitted here_.

**Destructive actions confirm**, naming what will happen — "Write off account ACC-2026-00892 (₹4,200 outstanding)", not "Are you sure?".

**No screen shows data the role may not see**, including in push payloads ([rbac-matrix](../01-product/rbac-matrix.md#money-visibility-m09-m11-m12)).
