# Business Rules

**This is the most important document in the set, and the one most in need of your review.**

The source PDF describes the business but leaves several money-critical questions unanswered. Each rule below states a decision, the reasoning, and a worked example using the PDF's own figures (₹10,000 account / ₹8,500 invested / ₹1,500 profit / ₹100 per day / 100 days).

Rules are referenced by ID (`BR-01`…) from every other document. Rules marked **⚠ RESOLVES AMBIGUITY** were not determined by the source document — these are the ones to check hardest.

---

## Account setup

### BR-01 — Account fields and derivation

At creation an Admin enters **Account Amount** (`A`), **Invested Amount** (`I`), **Instalment Amount** (`D`), **Term** (`N`, default 100), a **Collection Frequency** (BR-04) and a **Disbursement Date**.

`D` and `N` are read in the frequency's own unit — a daily account's ₹100 a day for 100 days, a weekly account's ₹500 a week for 20 weeks — and the form labels them so. `N` counts **instalments**, not calendar days, which is what keeps every rule below identical at all three frequencies.

**Profit is derived and never entered:** `P = A − I`.

Validation:

| Constraint                         | Reason                                                         |
| ---------------------------------- | -------------------------------------------------------------- |
| `A > 0`, `I > 0`, `D > 0`, `N > 0` | —                                                              |
| `I < A`                            | Profit cannot be zero or negative                              |
| `D ≤ A`                            | One instalment cannot exceed the whole account                 |
| `D × N ≥ A`                        | The schedule must be able to clear the account within its term |

If `D × N > A` the account simply completes before day `N`; this is legal and common. The form shows the implied term so the Admin sees it before saving.

> **Reference example:** `A = 10,000`, `I = 8,500` → `P = 1,500`. `D = 100`, `N = 100` → `D × N = 10,000 = A`. Exact fit.

### BR-01a — A customer may hold several active accounts at once ⚠ RESOLVES AMBIGUITY

There is no limit on concurrent `ACTIVE` accounts per customer. A customer with an account at day 60 can take a second account without clearing the first.

This is the single most far-reaching structural decision in the rule set, because it makes "what does this customer owe today" a **sum across accounts** rather than a value. Every part of the system has to respect that:

| Area                      | Consequence                                                                                                                                                                                                                                                  |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Collection**            | A collection is always recorded against **one specific account**, never against a customer. `accountLoanId` is mandatory and never inferred.                                                                                                                 |
| **Junior's route screen** | One customer may appear as several rows — one per active account, each with its own expected amount and its own confirm action. The customer's name appears once as a group header.                                                                          |
| **Cash at the door**      | A customer handing over ₹250 against two accounts expecting ₹100 and ₹150 requires the Junior to **split the entry across both accounts**. The UI must make this explicit; a single ₹250 field would be ambiguous and would corrupt both accounts' balances. |
| **Customer outstanding**  | A derived sum across active accounts. Never stored on `customer` — only per account.                                                                                                                                                                         |
| **Completion**            | Per account (BR-05). One account completing does not affect the other.                                                                                                                                                                                       |
| **Alerts**                | Raised per account. A customer underpaying one account and overpaying another produces two notifications, correctly.                                                                                                                                         |
| **Day close**             | Line totals sum across accounts; no change, since day close already aggregates collections rather than customers.                                                                                                                                            |

> **Design consequence worth stating plainly:** the Junior's screen is the place this hurts. The common case — one customer, one account, one tap — must stay one tap. The multi-account case must be visibly different rather than a subtle variation, or a Junior in a hurry will put the whole ₹250 against the first account. Screen specs will treat this as a distinct layout, not a loop.
>
> No database constraint is needed. Had the answer been "one active account", a partial unique index on `(customerId) WHERE status = 'ACTIVE'` would have enforced it; instead, nothing restricts it.

### BR-02 — Working days ⚠ RESOLVES AMBIGUITY

A **collection day** is any date that is not a Sunday and not a declared holiday.

- **Sundays** are excluded permanently (PDF §13).
- **Holidays** are configurable per sector, because local festival closures differ across regions. A national holiday is entered with business-wide scope.
- Holidays declared _after_ a schedule is generated shift the remaining schedule forward; already-collected days are never touched. **How far it shifts follows the account's frequency (BR-04):** a daily schedule is an unbroken run, so losing a day pushes every slot after it, and removing the holiday pulls them back. A weekly or monthly schedule has weeks or months of gap around each visit, so a holiday costs one visit its date and nothing else — and removing the holiday does not pull that visit back, because its anchor never moved and the customer has already been told the new date.

> The PDF mentions only Sundays. Holidays are added because a daily-collection business in India does not collect on major festival days, and without them every such day would raise a false "Missed" alert across every line at once.

### BR-03 — The disbursement day is not a collection day

`Day 0` is the disbursement date. The first collection falls on the **next working day**.

> PDF §2: _"From the next day, a daily collection is made."_

> **Worked example:** disbursement Saturday 3 Jan. Sunday 4 Jan is not a working day. First collection is **Monday 5 Jan**.

### BR-04 — Schedule generation

At creation the system materialises schedule slots on the dates the account's **collection frequency** gives, starting after day 0 (BR-03).

**The number of slots is `ceil(A ÷ D)`** — derived from the balance, not from `N`. Each slot expects `min(D, remaining)`, which makes the last slot absorb the remainder and the schedule sum to exactly `A`.

#### The three collection frequencies

An account is collected `DAILY`, `WEEKLY` or `MONTHLY`. **Daily is the default and the common case.** The frequency decides **where the slots fall and nothing else**: `D` is one instalment and `N` the number of instalments at whatever cadence is chosen, so BR-01's `D × N ≥ A`, BR-07's `min(D, remaining)` and BR-18's profit apportionment are the same calculation at every frequency. `N` is therefore counted in units of the cadence — days, weeks or months — and the form labels it accordingly.

| Frequency | Slot `i` falls                                                   | First slot           |
| --------- | ---------------------------------------------------------------- | -------------------- |
| `DAILY`   | the `i`-th working day after day 0                               | the next working day |
| `WEEKLY`  | `7 × i` calendar days after day 0                                | a week after day 0   |
| `MONTHLY` | `i` calendar months after day 0, clamped to the month's last day | a month after day 0  |

**Every anchor is measured from day 0**, one whole period per instalment, which is what makes BR-03's daily rule generalise and what keeps a regenerated tail (BR-06) right: `after` is the date the money moved, so a weekly customer's next visit is a week later, not tomorrow.

A weekly or monthly anchor that lands on a Sunday or a declared holiday **moves forward to the next working day (BR-02), while the anchors after it are still measured from day 0** — so the cadence never drifts. A customer collected on Wednesdays stays on Wednesdays: a holiday moves one visit to the Thursday and the visit after it is Wednesday again. Month-end clamping works the same way, from day 0 rather than by stepping: a monthly account disbursed on 31 December falls on 31 January, 28 February, 31 March and 30 April, and February borrowing a day never costs March one.

> **Worked example (weekly):** `A = 10,000`, `D = 500`, `N = 20 weeks`, disbursed Wednesday 23 September. Slots = `ceil(10,000 ÷ 500) = 20`, each ₹500. The first is Wednesday 30 September and each later one is seven days after the last. If 7 October is declared a holiday, that visit is Thursday 8 October and the next is still Wednesday 14 October.

The frequency is **immutable after disbursement**, like `A` and `I` — changing it would move every remaining visit on an account the customer has already been told the dates for. A database trigger enforces it.

> **Worked example (exact fit):** `A = 10,000`, `D = 100`. Slots = `ceil(10,000 ÷ 100) = 100`. Slots 1–99 expect ₹100, slot 100 expects ₹100. Sum = ₹10,000. ✓
>
> **Worked example (uneven):** `A = 10,000`, `D = 150`. Slots = `ceil(10,000 ÷ 150) = 67`. Slots 1–66 expect ₹150 (= ₹9,900), slot 67 expects ₹100. Sum = ₹10,000. ✓ The customer pays ₹100 on the final day, not ₹150.

> ⚠️ **Corrected during implementation.** This rule previously said the schedule has exactly `N` slots with the last equal to `A − D × (N − 1)`. That formula only holds when `N` happens to equal `ceil(A ÷ D)`, and it produces nonsense otherwise — with `A = 10,000`, `D = 150`, `N = 100` (which **passes BR-01 validation**, since `150 × 100 ≥ 10,000`) it yields a final slot of `10,000 − 150 × 99 = −4,850`.
>
> Deriving the count from the balance is both correct and consistent with BR-05: the term is a target, and an account that can clear sooner does. `N` remains what BR-01 validates against and what the Admin sees as the intended term.

The schedule is a _plan_, not a commitment — BR-06 explains how it is recomputed as reality diverges.

---

## Completion

### BR-05 — Completion is balance-driven ⚠ RESOLVES AMBIGUITY

**An account completes when `total collected ≥ A`.** Not on day 100.

`Outstanding = A − total collected`. When `Outstanding ≤ 0`, status becomes `COMPLETED` and the Senior is notified (PDF §12).

The term (`N` days) is a **target**, not a limit. Two consequences:

- Shortfalls **extend** the account. The customer keeps paying past day 100 until the account clears.
- Overpayments **finish it early**. Remaining schedule slots are cancelled.
- An account still open after its target completion date is flagged `OVERDUE` — still active and still collecting, but visible as behind schedule.

> **Why this rather than a hard 100 days.** The money owed is `A`. If the account closed on day 100 with ₹500 outstanding, that ₹500 would need a separate arrears process, a second collection workflow, and its own reporting — for what is really the same debt. Balance-driven keeps one concept, one workflow, and makes "outstanding" always mean the same thing.

> **Statuses:** `PENDING` (created, not yet disbursed) → `ACTIVE` → `COMPLETED`. `OVERDUE` is a flag on `ACTIVE`, not a separate status. `DEFAULTED` and `WRITTEN_OFF` are recorded manually by an Admin and stop collection.

### BR-06 — Target completion date is recomputed continuously

After every collection:

```
remainingDays   = ceil(Outstanding / D)
targetEndDate   = the remainingDays-th working day from the next collection day
```

A shortfall pushes the date out; an overpayment pulls it in. The schedule tail is regenerated to match; collected slots are never modified.

> **Worked example — shortfall.** `A = 10,000`, `D = 100`. Days 1–50 paid ₹100 each → collected ₹5,000, outstanding ₹5,000. On day 51 the customer pays **₹80**.
>
> - Collected = ₹5,080, Outstanding = ₹4,920
> - Variance = `80 − 100 = −20` → classified **LOW**, Senior notified (BR-08)
> - `remainingDays = ceil(4920 / 100) = 50`
> - The account now needs 50 more collection days after day 51 → **101 days total**. Target end date moves out by one working day.
>
> **Worked example — overpayment.** Same account, but on day 51 the customer pays **₹120**.
>
> - Collected = ₹5,120, Outstanding = ₹4,880
> - Variance = `+20` → classified **EXTRA**, Senior notified
> - `remainingDays = ceil(4880 / 100) = 49` → **100 days total**, no change to the end date yet.
> - The date moves in only once the surplus reaches a whole daily amount. A second ₹120 day leaves outstanding ₹4,760 → `ceil(47.6) = 48` more days after day 52 → still day 100. Five ₹120 days (₹100 surplus) leave ₹4,400 → 44 more days after day 55 → **day 99**.
>
> ⚠️ **Corrected during implementation.** This example previously said a second ₹120 day would pull the end date in to 99. It does not: ₹40 of surplus is not a whole day.

---

## Daily collection

### BR-07 — Expected amount is capped at outstanding ⚠ RESOLVES AMBIGUITY

The expected amount on any collection day is:

```
expected = min(D, Outstanding)
```

This prevents over-collection on the final day without any special-casing.

> **Worked example.** Outstanding is ₹50 and `D = 100`. Expected is **₹50**, not ₹100. The Junior's screen shows ₹50, the customer pays ₹50, and the account completes with variance zero — rather than the customer paying ₹100, overpaying by ₹50, and the business owing a refund.

### BR-08 — Variance classification

For each collection: `variance = collected − expected`.

| Condition                          | Classification | Senior notified?                       |
| ---------------------------------- | -------------- | -------------------------------------- |
| `variance = 0`                     | `CORRECT`      | No                                     |
| `variance < 0` and `collected > 0` | `LOW`          | Yes — Alert                            |
| `variance > 0`                     | `EXTRA`        | Yes — Warning                          |
| `collected = 0`, visit recorded    | `NO_PAYMENT`   | Yes — Alert                            |
| No record on a due collection day  | `MISSED`       | Yes — Alert, raised by a scheduled job |

The `collected = 0` row is decided first: a ₹0 visit against a ₹0 expectation is `NO_PAYMENT`, not `CORRECT`.

Classification is computed and stored at write time, not derived at read time — the expected amount changes as the account progresses, so a variance computed later would not reproduce the value that was true on the day.

**`CORRECT` requires an exact match.** There is no tolerance band. Daily amounts are round figures (₹100, ₹150) and customers pay them exactly, so any variance is genuinely notable and worth a Senior's attention. A tolerance band would only be needed if rounding were routine, which it is not.

> Should alert volume prove otherwise after launch, a `collection.varianceTolerance` setting is a contained addition — one settings row and one comparison. It is deliberately **not** built now, because an unused tolerance of zero is indistinguishable from no tolerance at all, and the setting would be dead configuration.

### BR-09 — Missed, no-payment and holiday are three different things ⚠ RESOLVES AMBIGUITY

| State            | Record exists?          | What it means                                               | Counts against customer? |
| ---------------- | ----------------------- | ----------------------------------------------------------- | ------------------------ |
| `MISSED`         | No collection record    | The Junior did not visit. **Staff failure.**                | No                       |
| `NO_PAYMENT`     | Record with amount `0`  | Junior visited; customer paid nothing. **Customer signal.** | Yes                      |
| Holiday / Sunday | No schedule slot at all | Not a collection day. Nothing expected.                     | No                       |

> This distinction does not exist in the source PDF and it matters more than it looks. Collapsing `MISSED` into `NO_PAYMENT` would blame customers for staff absence and corrupt any future view of customer reliability. Collapsing holidays into `MISSED` would fire a false alert for every customer on every line simultaneously.
>
> `MISSED` is raised by a scheduled job after the line's day close, not in real time — a Junior collecting at 6pm has not "missed" anything at noon.

### BR-10 — Advance payments credit the balance; the daily amount never moves ⚠ RESOLVES AMBIGUITY

An extra ₹20 today reduces the outstanding balance and brings the completion date forward. **Tomorrow's expected amount stays `D`** (subject to BR-07's cap).

> The rejected alternative was redistributing the surplus across remaining days, which lowers the daily figure slightly. Both are arithmetically fine, but a daily amount that drifts is unusable in the field: the Junior and the customer both rely on "₹100 a day" being a fixed, memorable number. The customer's reward for paying extra is finishing sooner, not paying ₹99.70 tomorrow.
>
> The same logic applies in reverse to shortfalls (BR-06): the daily amount does not rise to catch up; the account simply runs longer.

---

## Money, dates and identity

### BR-11 — Money is `NUMERIC(14,2)`, never floating point

All monetary values are PostgreSQL `NUMERIC(14,2)`, mapped to Prisma `Decimal`.

- Rounding is **half-up to 2 decimal places**, applied only at display or at an explicit boundary — never accumulated mid-calculation.
- **No `float`/`double`/JS `number` anywhere in the money path**, including the frontend. Amounts cross the API as decimal strings and are parsed into a decimal type, not a JS number.
- `14,2` holds up to ₹999,999,999,999.99 — far beyond need, and cheap.

> This is a correctness rule, not a style preference. ₹0.01 of floating-point drift per collection, across 1,000 customers over 100 days, is 100,000 opportunities for the ledger to stop balancing.

### BR-12 — Business date is `Asia/Kolkata`, stored explicitly

Every collection stores both:

- `capturedAt` — `timestamptz`, the exact instant
- `businessDate` — `date`, computed once as `DATE(capturedAt AT TIME ZONE 'Asia/Kolkata')` and **stored**

All daily aggregation groups by `businessDate`. Never by a timezone conversion applied at query time.

> **Worked example.** A collection recorded at `2026-01-05 23:40 IST` is `2026-01-05 18:10 UTC` — same day either way. But one at `2026-01-05 05:10 IST` is `2026-01-04 23:40 UTC` — **the previous UTC day**. Grouping by UTC date would silently move that morning's collection into yesterday's tally, and the line would fail to balance for reasons nobody could see.
>
> Storing the value rather than computing it also means an index can be used, and that a future timezone policy change cannot retroactively rewrite history.

### BR-13 — Offline collections are made safe by idempotency keys

The client generates a UUID v4 for each collection **at the moment of recording**, before any network attempt, and stores it with the queued entry.

- The server enforces a unique constraint on the key.
- A replayed key returns the **original result** with `200`, not a conflict error. A duplicate submission is a success, not a failure — the collection exists, which is what the client needs to know.
- Keys are retained 90 days, then purged.

> The key must be generated at record time, not at send time. Generating it when the request is dispatched means a retry after an ambiguous outcome carries a _new_ key — which is precisely the duplicate the mechanism exists to prevent.

### BR-14 — Collections are append-only; corrections are new records

A recorded collection is never updated or deleted.

A correction creates a **new** collection record of type `ADJUSTMENT` referencing the original, and requires approval from a Senior (for their own line) or an Admin. A Senior may approve a correction they asked for themselves; an Admin may not approve their own reversal (decided 2026-09-22). A full reversal is an adjustment for the negative of the original amount.

The customer's collected total is the sum of all records — originals plus adjustments. Both the original and the correction remain visible in history.

> In a cash business, the ability to silently change a past figure is the risk. Append-only removes it structurally rather than relying on an audit log to catch it afterwards.

### BR-15 — Line attribution is frozen at collection time

Each collection stores the `lineId` it was collected under, denormalised at write time.

Line-wise reports group by `collection.lineId`, **not** by the customer's current line.

> **Worked example.** A customer on Line 3 for 60 days transfers to Line 7. Without this rule, Line 3's historical collection totals would instantly drop by that customer's 60 days of payments and Line 7's would jump — rewriting the past performance of two lines and two Seniors. Frozen attribution keeps every closed day permanently reproducible.
>
> The same applies to `collectedByUserId`, which records who actually collected, independent of who is assigned to the line today.
>
> **The frozen line is the one the customer was on when the money was taken**, which for a collection synced after a transfer (US-023) is not the line they are on now. `customer_line_period` records which line that was on any business date; on the transfer day itself both lines cover the date and the collecting Junior’s own line is used.

---

## Cash control

### BR-16 — Day close is per line, per business date

At the end of each business date, each line closes:

```
expectedTotal   = Σ expected amounts of that line's slots due that date
collectedTotal  = Σ collections recorded for that line on that date
shortfall       = expectedTotal − collectedTotal   (when positive)
surplus         = collectedTotal − expectedTotal   (when positive)
```

A line has **tallied** when it is closed _and_ its cash handovers reconcile to `collectedTotal` with no discrepancy.

Closing locks the line's collections for that date: further entries require an Admin to reopen the day, which is audited.

### BR-16a — A late offline sync reopens a closed day ⚠ RESOLVES AMBIGUITY

A collection that syncs after its line has already closed is **accepted and attached to its true `businessDate`** (BR-12). The day close transitions `CLOSED → REOPENED`, totals are recomputed, and the Senior is notified.

Consequences, accepted deliberately:

- A closed day is not final until every device on that line has synced. `CLOSED` means "the Senior has tallied what is known"; `TALLIED` means the cash reconciles. Only an Admin-locked month-end is truly immutable.
- The Senior may have to re-tally. The notification says so explicitly rather than leaving them to notice a changed figure.
- Reopening is automatic and does not require the `reopenReason` that a manual reopen demands — but it is still written to the audit log, with the system as actor.

> The rejected alternative was posting late collections to the next business date, which keeps closed days immutable. It was rejected because it records a payment on a day the customer did not pay, breaking reconciliation against the paper collection note in the customer's hand — the one document the customer can actually check. Stable books are worth less than books that match reality.

### BR-17 — Cash moves Junior → Senior → Admin, counted at each step

Each handover records the amount, a denomination breakdown, the sender, the receiver, and the receiver's acknowledgement. Cash is only considered moved once acknowledged.

`Discrepancy = cash declared − collections recorded` for that Junior, that date.

Because each hop is counted, a discrepancy is attributable to a specific handover rather than to a whole day or a whole line.

> Denomination counts are what make this practical: "₹200 short" is an argument, while "one ₹200 note short" is a countable fact that both parties can check on the spot.

### BR-18 — Every money event posts to the ledger, in the same transaction

The ledger is double-entry and append-only. Postings within a transaction always sum to zero. A ledger transaction commits **in the same database transaction** as the state change it describes, so the ledger can never record a collection that rolled back.

**Ledger accounts:** `CASH_IN_HAND` (one per staff member), `CASH_AT_OFFICE`, `LOAN_RECEIVABLE` (one per account), `CAPITAL`, `UNEARNED_PROFIT`, `EARNED_PROFIT`.

**Disbursement** — `A = 10,000`, `I = 8,500`, `P = 1,500`:

| Ledger account               |     Debit |   Credit |
| ---------------------------- | --------: | -------: |
| `LOAN_RECEIVABLE` (customer) | 10,000.00 |          |
| `CASH_AT_OFFICE`             |           | 8,500.00 |
| `UNEARNED_PROFIT`            |           | 1,500.00 |

The customer owes ₹10,000; ₹8,500 of cash left the business; ₹1,500 of profit is recognised but not yet earned.

**Collection of ₹100** — profit is recognised proportionally, at `P / A = 15%`:

| Ledger account               |  Debit | Credit |
| ---------------------------- | -----: | -----: |
| `CASH_IN_HAND` (Junior)      | 100.00 |        |
| `LOAN_RECEIVABLE` (customer) |        | 100.00 |
| `UNEARNED_PROFIT`            |  15.00 |        |
| `EARNED_PROFIT`              |        |  15.00 |

**Handover of ₹5,000, Junior → Senior:**

| Ledger account          |    Debit |   Credit |
| ----------------------- | -------: | -------: |
| `CASH_IN_HAND` (Senior) | 5,000.00 |          |
| `CASH_IN_HAND` (Junior) |          | 5,000.00 |

> Proportional profit recognition means `EARNED_PROFIT` at any moment reflects profit on money actually received — so a half-collected account shows roughly half its profit, not all of it. This is what makes the Super Admin's profit figure meaningful rather than optimistic.
>
> **Rounding is on the running total ⚠ RESOLVES AMBIGUITY.** 15% of a ₹100 collection is exactly ₹15.00, but uneven amounts do not divide cleanly. Profit earned to date is `round(collected × P / A)`, half-up to the paisa, and each collection or adjustment posts the change in that figure:
>
> ```
> profit = round(collectedAfter × P/A) − round(collectedBefore × P/A)
> ```
>
> The ledger is never more than half a paisa from the exact figure, and when `collected = A` earned profit is exactly `P` — so `UNEARNED_PROFIT` for a completed account always lands at zero without anyone needing to identify "the final collection", which late offline syncs and corrections would make unreliable.
>
> **Worked example (uneven):** `A = 9,999`, `I = 8,500`, `P = 1,499`, ₹100 a day. Collections 1–3 post ₹14.99; collection 4 posts ₹15.00, bringing earned profit to ₹59.97. Fifteen of the 100 collections post ₹15.00, and the final ₹99 posts ₹14.84 — total exactly ₹1,499.
>
> The accepted cost: a full reversal can differ from its original's profit by ₹0.01. The ledger balances either way. The rejected alternative — rounding each collection alone and having the final one absorb the residue — drifts by up to half a paisa per collection and depends on correctly spotting the final collection.

---

## Open questions

These need your answer before the affected modules can be specified.

**Resolved since first draft:** variance tolerance (BR-08 — exact match, no band), concurrent accounts (BR-01a — multiple allowed), late offline sync (BR-16a — reopens the day).

Still open. Each has a proposed answer that will be taken as the decision unless you say otherwise, since none blocks the remaining documents:

| #   | Question                                                                     | Affects    | Proposed                                                                                                                                          |
| --- | ---------------------------------------------------------------------------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Who may declare a holiday, and how far ahead?                                | BR-02      | Admin and Super Admin, any future date. Declaring a holiday in the past is blocked — it would retroactively invalidate alerts already raised      |
| 2   | What happens to an account when its customer is marked `INACTIVE` mid-term?  | BR-05      | Collection continues. Only `DEFAULTED` / `WRITTEN_OFF` on the account stop it; customer status is a contact-quality flag, not a collection switch |
| 3   | Is there a grace period before an open account is flagged `OVERDUE`?         | BR-05      | None — flagged the day after `targetCompletionDate`. A grace period hides exactly the signal the flag exists to surface                           |
| 4   | Can a Junior record a collection for a customer outside their assigned line? | BR-15, M02 | No. Scoping is enforced server-side, not merely hidden in the UI                                                                                  |
| 5   | When a Junior is reassigned mid-day, who owns that day's cash?               | BR-17      | The Junior who collected it. Handover follows `collection.collectedByUserId`, not current line staffing                                           |
