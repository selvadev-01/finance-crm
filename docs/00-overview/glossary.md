# Glossary

The domain vocabulary is specific, and several terms mean something narrower than their everyday English sense. Read this before any other document. Terms are used exactly as defined here throughout the specification, in code, and in the UI.

---

## Business structure

**Sector**
The largest organisational unit below the business itself — a geographic region. A sector contains multiple lines. Sectors do not overlap.

**Line** *(also "collection line")*
A route: the set of customers one team visits. A line belongs to exactly one sector, has exactly one Senior, and has one or more Juniors. A line is the unit at which daily cash is tallied and reconciled. This is the most important operational unit in the system — most reports, alerts and dashboards are line-scoped.

**Business**
The whole operation: all sectors, all lines. The Super Admin's scope. Sometimes called "overall" in rollup contexts.

**Rollup chain**
`Customer → Line → Sector → Business`. Every money figure aggregates upward along this chain, and only this chain.

---

## People

**Super Admin**
The owner. Full visibility and control over the entire business. There is normally exactly one.

**Admin**
Runs day-to-day operations: creates customers and accounts, manages sectors and lines, assigns staff. Does not collect cash in the field.

**Senior**
Supervises exactly one line. Monitors the Juniors on that line, verifies their collections, receives cash from them, and receives the alerts raised on that line. A Senior's visibility is limited to their own line.

**Junior**
Collects cash from customers in the field and records each collection in Rasi. A Junior is assigned to one line at a time and sees only the customers assigned to them. Juniors move between lines relatively often; Seniors rarely do.

**Staff**
Collective term for Super Admin, Admin, Senior and Junior — anyone who logs in. Distinct from *customer*, who never logs in.

**Customer**
The borrower. Has a profile and one or more accounts. **Customers are not users** — they have no login, no credentials, and no access to Rasi.

**Reference person**
A contact provided by the customer at onboarding, used to trace the customer if they become unreachable. Not a guarantor in any legal sense, and carries no liability in the system.

---

## Money

**Account**
A single lending agreement with a customer. The PDF and all user-facing text call this an "Account". In the database the entity is `account_loan`, because `account` is claimed by the authentication library — see [ADR: Better Auth](../02-architecture/adr/).

**A customer may hold several active accounts simultaneously.** This is why a collection is always recorded against an *account*, never against a customer, and why "what does this customer owe" is a sum rather than a single figure.

> ⚠️ "Account" in Rasi means **a loan**. It does not mean a user account, a login, or a ledger account. When a ledger account is meant, the term used is always **ledger account**.

**Account Amount** — the total the customer repays. `₹10,000` in the reference example. Fixed at creation.

**Invested Amount** — the cash actually handed to the customer at disbursement. `₹8,500`. Always less than the account amount.

**Profit** — `Account Amount − Invested Amount`. `₹1,500`. Derived, never entered by hand.

**Daily Amount** — the amount expected from the customer on each collection day. `₹100`.

**Term Days** — the target number of collection days. `100` by default. A *target*, not a hard limit: see **Balance-driven completion**.

**Outstanding** — `Account Amount − total collected to date`. The account completes when this reaches zero.

---

## Collection

**Collection day**
A day on which collection is expected. Sundays and declared holidays are **not** collection days. The disbursement day is not a collection day either — collection starts the next working day.

**Working day**
Synonym for collection day, used when discussing the calendar rather than a specific account.

**Collection** *(noun)*
One recorded payment from one customer on one business date. Collections are append-only: a mistake is corrected by a new adjusting record, never by editing the original.

**Expected amount**
What the customer should pay on a given collection day — normally the Daily Amount, but capped at the Outstanding so the final payment never overshoots.

**Variance**
`Collected − Expected` for a single collection. Drives the classification below.

**Correct / Low / Extra**
The three variance outcomes. **Correct** = variance zero. **Low** = customer paid less than expected; the Senior is alerted. **Extra** = customer paid more than expected; the Senior is alerted. Both Low and Extra are notable events, not errors.

**Missed**
A collection day on which the customer was not visited at all. Distinct from a visit where the customer paid nothing — see the three states below.

> Three states are easy to conflate and must not be:
> - **Missed / not visited** — the Junior never went. No collection record exists. An operational failure by staff.
> - **Visited, no payment** — the Junior went; the customer paid ₹0. A collection record exists with amount zero. A customer behaviour signal.
> - **Holiday** — not a collection day at all. Nothing is expected, nothing is owed, no alert fires.

**Business date**
The calendar date a collection belongs to, in `Asia/Kolkata`. Not the UTC date, and not the server's date. A collection recorded at 23:40 IST belongs to that day, not the next.

---

## Cash control

**Tally** *(also "daily tally")*
The end-of-day reconciliation for one line on one business date: what was expected, what was collected, and whether the physical cash matches. A line whose cash matches its recorded collections has "tallied".

**Day close**
The act of completing the tally and locking the line's collections for that business date.

**Handover**
The physical transfer of cash up the chain: Junior → Senior → Admin. Each handover is recorded with a denomination count and acknowledged by the receiver.

**Denomination count**
A breakdown of physical notes and coins (how many ₹500 notes, how many ₹200, and so on) accompanying a handover. Makes discrepancies traceable to a specific handover rather than a whole day.

**Discrepancy**
A mismatch between cash declared in a handover and collections recorded in the system.

**Ledger account**
An account in the double-entry bookkeeping sense — cash in hand, loan receivable, capital, earned profit. Never abbreviated to "account" in text or code.

**Posting**
A single debit or credit line in the ledger. Every transaction has at least two postings, and they always sum to zero.

---

## Technical

**Outbox**
Two distinct things, disambiguated by context — always qualify which:
- **Client outbox** — the offline queue in the Junior's browser holding collections recorded without network, awaiting replay.
- **Notification outbox** — the server-side table guaranteeing a notification is dispatched exactly once even if push delivery fails.

**Idempotency key**
A client-generated unique identifier attached to a collection at the moment it is recorded, so replaying it after an uncertain network outcome cannot create a duplicate.

**Line assignment**
The historical record of which staff member worked which line, and when. Kept as history rather than a current-value field, because reassignments must not rewrite past reports.
