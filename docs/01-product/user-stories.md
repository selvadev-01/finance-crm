# User Stories

Ten epics, mapped to modules. Stories are `US-nnn` and referenced from the backlog.

Acceptance criteria are Gherkin. Money-critical stories carry full scenarios including the failure paths; routine CRUD carries condensed criteria — the detail there lives in the screen specs.

**Priority:** `P0` release-blocking · `P1` needed for a usable v1 · `P2` valuable, deferrable.

---

## E01 — Identity and Access (M01, M02)

### US-001 · Staff sign-in · P0

_As a staff member, I want to sign in, so that I can use Rasi._

```gherkin
Scenario: Valid credentials
  Given I am a staff member with status ACTIVE
  When I sign in with my correct email and password
  Then a session is created
  And I land on the screen for my role
  And a LOGIN entry is written to the audit log

Scenario: Suspended staff member
  Given my staff status is SUSPENDED
  When I sign in with correct credentials
  Then I am refused
  And the message does not reveal whether the password was correct

Scenario: Field device stays signed in
  Given I am a Junior signed in on my phone
  When I return to the app the next morning without connectivity
  Then I am still signed in
  And my cached route is available
```

> The last scenario is a hard requirement, not a nicety. A session expiring overnight would strand a Junior with no way to sign in and no way to record collections.

### US-002 · Sign out · P0

Session invalidated server-side; **any unsynced offline collections block sign-out with a warning**, since local data is lost with the session.

### US-003 · Password reset · P1

Email-based. Admin-initiated reset for field staff without email access.

### US-004 · Server-side scope enforcement · P0

_As the business, I want data scoping enforced by the API, so that hidden UI is not the only protection._

```gherkin
Scenario: Junior requests another line's customer
  Given I am a Junior assigned to Line 3
  When I request a customer on Line 7 directly by id
  Then I receive 404
  And the response does not reveal that the customer exists

Scenario: Senior requests a business-wide total
  Given I am a Senior on Line 3
  When I request the business dashboard endpoint
  Then I receive 403

Scenario: Scope follows reassignment
  Given I am a Senior moved from Line 3 to Line 7 yesterday
  When I list collections
  Then I see Line 7 collections including those recorded before my transfer
  And I see no Line 3 collections
```

### US-005 · Register a device for push · P1

Device registers for Web Push or FCM depending on the configured provider; the same user may have several active devices.

### US-006 · Organization sign-up · P1

Decided 2026-09-15 ([ADR-0012](../02-architecture/adr/0012-organization-sign-up.md)).

```gherkin
Scenario: The owner of a new business signs up
  When the owner enters the business name "Lakshmi Finance", their name, email, mobile and a password
  Then an organization is created with the owner as its active Super Admin
  And its sign-in link is "/lakshmi-finance/sign-in", generated without the owner typing it
  And the owner is signed in with the password they chose and shown that link
  And the organization and the owner's staff profile are audited

Scenario: Two businesses with the same name
  Given "Lakshmi Finance" already has the link "/lakshmi-finance/sign-in"
  When another owner signs up as "Lakshmi Finance"
  Then their link is "/lakshmi-finance-2/sign-in"

Scenario: Staff use their business's link
  When a staff member opens "/lakshmi-finance/sign-in"
  Then the page names "Lakshmi Finance"
  And an account from another business is signed back out and told to use its own link

Scenario: Repeated sign-ups from one address
  When one address makes a sixth sign-up attempt within an hour
  Then it is refused with 429 and nothing is created

Scenario: Codes belong to one business
  Given another organization already has a line coded "LN-01"
  When the new owner creates a line coded "LN-01"
  Then it is accepted
```

Every other staff member is still created by an Admin (US-092).

---

## E02 — Organisation (M03)

### US-010 · Manage sectors · P0

Create, rename, deactivate. A sector with active lines cannot be deactivated.

### US-011 · Manage lines · P0

Create a line within a sector, rename, deactivate. A line with `ACTIVE` accounts cannot be deactivated.

### US-012 · Assign a Senior to a line · P0

```gherkin
Scenario: Assigning replaces the incumbent
  Given Line 3 currently has Senior Priya
  When an Admin assigns Senior Rajan to Line 3 effective today
  Then Priya's assignment is closed with effectiveTo = yesterday
  And Rajan's assignment opens with effectiveFrom = today
  And both staff members are notified
  And no assignment record is deleted
```

### US-013 · Move a Junior between lines · P0

_As an Admin, I want to move a Junior to another line, so that staffing follows demand._

```gherkin
Scenario: Mid-term reassignment preserves history
  Given Junior Suresh is on Line 3 and has recorded 400 collections there
  When an Admin moves Suresh to Line 7 effective tomorrow
  Then his Line 3 assignment closes today
  And his 400 existing collections remain attributed to Line 3
  And Line 3's historical totals are unchanged
  And the Seniors of both lines are notified
```

> This scenario is the acceptance test for BR-15. If Line 3's totals move, the implementation is wrong.

### US-014 · View who is on which line · P1

Covers PDF §20 — Senior, Junior count and customer count per line.

### US-015 · View assignment history · P2

Who was responsible for a line on any past date. Needed when investigating an old discrepancy.

---

## E03 — Customers (M04)

### US-020 · Onboard a customer · P0

Name, mobile, address, sector, line, and at least one reference person. Assignment to a Junior happens here or at account creation.

```gherkin
Scenario: Reference is mandatory
  Given I am creating a customer
  When I submit without a reference person
  Then the form is rejected identifying the missing field

Scenario: Duplicate mobile is allowed but warned
  Given a customer already exists with mobile 9876543210
  When I create another customer with the same mobile
  Then I see a warning showing the existing customer
  And I may proceed
```

> Mobile numbers are shared within families and between a customer and their shop. Blocking duplicates would obstruct real onboarding; warning catches genuine double-entry.

### US-021 · Edit a customer · P1

### US-022 · Customer 360 · P1

Profile, all accounts (active and completed), full collection history, outstanding across accounts, references, assigned staff.

```gherkin
Scenario: Multiple active accounts
  Given a customer holds two ACTIVE accounts with outstanding 4,000 and 7,500
  When I open their profile
  Then each account is listed separately with its own outstanding
  And the total outstanding shows 11,500
  And the total is labelled as a sum across accounts
```

### US-023 · Transfer a customer to another line · P1

Future collections attribute to the new line; historical collections do not move (BR-15).

### US-024 · Search customers · P1

By name, mobile or code, scoped by role.

---

## E04 — Accounts (M05, M06)

### US-030 · Create an account · P0

_As an Admin, I want to create an account with live-derived values, so that mistakes surface before saving._

```gherkin
Scenario: Derivation is live
  Given I am creating an account
  When I enter account amount 10,000 and invested amount 8,500
  Then profit shows 1,500 immediately
  And profit is not editable

Scenario: Schedule preview
  Given account amount 10,000, daily 100, term 100 days
  And disbursement date Saturday 3 January
  When the preview renders
  Then the first collection date is Monday 5 January
  And 100 collection slots are shown
  And no slot falls on a Sunday or declared holiday
  And the slot amounts sum to exactly 10,000

Scenario: Invested must be below account amount
  When I enter invested amount 10,500 against account amount 10,000
  Then the form is rejected
  And the reason states that profit cannot be zero or negative

Scenario: Term must be able to clear the account
  When I enter account 10,000, daily 50, term 100 days
  Then the form is rejected
  And the reason states that 50 x 100 cannot clear 10,000

Scenario: A second concurrent account is permitted
  Given a customer already holds an ACTIVE account
  When I create another account for them
  Then it is accepted
  And both accounts appear on their profile
```

### US-030a · Create a mid-term account · P0

_As an Admin, I want to enter a customer who is already partway through their term, so that existing customers can be brought into Rasi._

```gherkin
Scenario: Past disbursement date with a collected balance
  Given a customer who started on 1 July and has paid 4,700 of 10,000
  When I create the account with disbursement date 1 July and collected to date 4,700
  Then the account is ACTIVE with outstanding 5,300
  And the schedule is generated from 1 July excluding Sundays and holidays
  And the target completion date is computed from the outstanding balance
  And the ledger balances: disbursement posted, 4,700 of collections posted

Scenario: Behaves identically to a day-one account
  Given a mid-term account with outstanding 5,300 and daily amount 100
  And a day-one account that has been collected down to outstanding 5,300
  Then both show the same expected amount tomorrow
  And both compute the same target completion date
  And both complete on reaching zero outstanding

Scenario: Collected amount is entered, never inferred
  Given a customer on day 47 of a 100-day term at 100 per day
  And they underpaid on six occasions, having actually paid 4,580
  When I enter 4,580 as collected to date
  Then outstanding is 5,420
  And the account is not treated as though 4,700 had been collected
```

> The third scenario is the one that matters. Inferring the balance as `47 × ₹100 = ₹4,700` overstates it for every customer who ever underpaid — and an overstated balance means the account completes early and the business never collects the difference.

### US-030b · Choose a weekly or monthly collection frequency · P1

_As an Admin, I want to set how often a customer is collected from, so that an account that is not a daily round can be run in Rasi rather than on paper._

```gherkin
Scenario: A weekly account is collected once a week, on the same weekday
  Given account amount 10,000, weekly amount 500, term 20 weeks
  And a disbursement date of Wednesday 23 September
  When the schedule is generated
  Then there are 20 slots, each of 500, totalling 10,000
  And the first is Wednesday 30 September, a week after day 0
  And every later slot is seven calendar days after the one before it

Scenario: A holiday moves one visit, not the cadence
  Given a weekly account collected on Wednesdays
  When 7 October is declared a holiday
  Then that visit moves to Thursday 8 October
  And the visit after it is still Wednesday 14 October

Scenario: A monthly account keeps its day of the month
  Given a monthly account disbursed on 31 December
  When the schedule is generated
  Then the visits fall on 31 January, 28 February, 31 March and 30 April
  And a visit falling on a Sunday or a holiday moves to the next working day

Scenario: The term counts instalments, not days
  Given a weekly account at 500 a week
  When I enter a term of 20
  Then it means 20 weekly visits
  And a term that cannot clear the account is refused as "500 × 20 weeks cannot clear 10,000"
```

> The cadence changes **where the slots fall and nothing else**. `D` is still one instalment and `N` still the number of them, so BR-01's `D × N ≥ A`, BR-07's `min(D, remaining)` and BR-18's profit apportionment are the same calculation at every frequency. Daily remains the default and the common case.

### US-031 · Uneven final instalment · P0

```gherkin
Scenario: Last slot absorbs the remainder
  Given account amount 10,000, daily 150, term 67 days
  When the schedule is generated
  Then slots 1 to 66 expect 150
  And slot 67 expects 100
  And the total equals 10,000
```

### US-032 · Disburse an account · P0

Status `PENDING → ACTIVE`; ledger posts the disbursement (BR-18); schedule activates.

### US-033 · Account completes on balance · P0

```gherkin
Scenario: Completion on reaching zero
  Given an account with outstanding 100
  When a collection of 100 is recorded
  Then outstanding becomes 0
  And status becomes COMPLETED
  And actualCompletionDate is set to that business date
  And remaining schedule slots become CANCELLED
  And the Senior is notified

Scenario: Shortfall extends past the target date
  Given an account at day 100 with outstanding 500
  When the target completion date passes
  Then the account remains ACTIVE
  And isOverdue becomes true
  And collection continues
  And it appears in the line's overdue list

Scenario: Overpayment finishes early
  Given an account with outstanding 80 and daily amount 100
  When the Junior opens the route screen
  Then the expected amount shows 80, not 100
  And collecting 80 completes the account with variance 0
```

> The third scenario is the acceptance test for BR-07. If the screen shows ₹100, the customer overpays and the business owes a refund.

### US-034 · Working-day calculation · P0

```gherkin
Scenario: Sundays excluded
  Given a schedule starting Monday 5 January
  Then no slot falls on any Sunday

Scenario: Holiday shifts the remaining schedule
  Given an account with pending slots on 14, 15 and 16 January
  When an Admin declares 15 January a holiday for that sector
  Then the 15 January slot moves to the next working day
  And subsequent slots shift accordingly
  And already-collected slots are untouched

Scenario: Holiday raises no missed alerts
  Given 15 January is a declared holiday
  When the missed-collection job runs for that date
  Then no MISSED alerts are raised for any customer
```

### US-035 · Close an account manually · P2

Super Admin marks `DEFAULTED` or `WRITTEN_OFF` with a mandatory reason; collection stops; the ledger posts a write-off.

---

## E05 — Collections (M07)

### US-040 · View today's route · P0

_As a Junior, I want today's route, so that I know who to visit and what to collect._

```gherkin
Scenario: Route content
  Given I am a Junior with 45 assigned customers
  When I open my route for today
  Then I see only customers with a collection due today
  And each row shows name, address, expected amount and outstanding
  And no invested amount or profit figure appears anywhere

Scenario: A customer with two accounts
  Given an assigned customer holds two ACTIVE accounts expecting 100 and 150
  When I open my route
  Then the customer appears once as a group
  And two separate collection rows appear beneath, each with its own amount
  And each row confirms independently

Scenario: Sunday
  Given today is Sunday
  When I open my route
  Then it is empty
  And a message explains that Sunday is not a collection day
```

### US-041 · Record a collection · P0

```gherkin
Scenario: Exact amount
  Given a customer expects 100 today
  When I record 100
  Then the collection saves with variance 0 and classification CORRECT
  And no notification is raised
  And the outstanding reduces by 100

Scenario: Low collection
  When I record 80 against an expected 100
  Then variance is -20 and classification is LOW
  And my Senior receives an ALERT notification
  And the target completion date moves out

Scenario: Extra collection
  When I record 120 against an expected 100
  Then variance is +20 and classification is EXTRA
  And my Senior receives a WARNING notification
  And the outstanding reduces by 120

Scenario: Customer paid nothing
  When I record a visit with amount 0
  Then classification is NO_PAYMENT
  And my Senior receives an ALERT
  And this is distinguishable from never having visited

Scenario: Cannot exceed outstanding
  Given an account with outstanding 80
  When I attempt to record 200
  Then it is rejected
  And the reason states the outstanding is 80
```

### US-042 · Split a payment across accounts · P1

_As a Junior, I want to split one payment across a customer's accounts, so that each account's balance is correct._

```gherkin
Scenario: Explicit split
  Given a customer holds two accounts expecting 100 and 150
  And the customer hands me 250
  When I record the collection
  Then I must enter an amount against each account separately
  And there is no single combined amount field
  And two collection records are created
```

> A single ₹250 field would be ambiguous and would corrupt both balances. The split must be explicit (BR-01a).

### US-043 · Missed collections detected · P0

```gherkin
Scenario: Missed raised after day close
  Given a customer had a slot due today
  And no collection was recorded
  When the missed-collection job runs after the line closes
  Then the slot becomes MISSED
  And the Senior receives an ALERT identifying the Junior
  And the customer's account is not penalised

Scenario: Late entry clears the missed flag
  Given a slot was marked MISSED
  When a collection for that date syncs later
  Then the slot becomes COLLECTED
  And the missed alert is resolved
```

### US-044 · Request a correction · P1

```gherkin
Scenario: Correction requires approval
  Given I recorded 100 but actually collected 80
  When I request a correction to 80
  Then the original record is unchanged
  And an ADJUSTMENT of -20 is created with status PENDING_APPROVAL
  And it does not affect the balance until approved
  And my Senior is notified

Scenario: Approval applies the adjustment
  When my Senior approves it
  Then the adjustment becomes CONFIRMED
  And the outstanding increases by 20
  And the ledger posts a corresponding transaction
  And both records remain visible in history

Scenario: A Senior may decide their own request
  Given I am a Senior who requested a correction
  When I approve or reject it myself
  Then the decision stands as any other would

Scenario: An Admin may not approve their own reversal
  Given I am an Admin who reversed a collection
  When I attempt to approve it myself
  Then I am refused, and another Admin must decide it
```

> Decided 2026-09-22: a Senior may decide their own correction. A line usually has one Senior, and waiting for an Admin held the correction, and the Junior's view of it, open. An Admin's own reversal still needs a second person.

### US-045 · View collection history · P1

Per account and per customer, showing originals and adjustments with variance and collector.

---

## E06 — Offline (M07)

The hardest requirement in v1. These stories are the acceptance tests for BR-13.

### US-050 · Record a collection with no network · P0

```gherkin
Scenario: Offline save
  Given my phone has no connectivity
  When I record a collection
  Then it saves locally in under 100 ms
  And I see confirmation that it is saved on the device
  And the row is marked "not yet synced"
  And I am never shown a spinner or a network error
```

### US-051 · Route available offline · P0

```gherkin
Scenario: Cached route
  Given I loaded my route this morning while online
  When I lose connectivity for the rest of the day
  Then the full route remains available
  And expected amounts and outstanding balances are shown from cache
  And balances update locally as I record collections
```

### US-052 · Automatic sync on reconnect · P0

```gherkin
Scenario: Queue drains in order
  Given I have 12 collections queued offline
  When connectivity returns
  Then they sync automatically without my intervention
  And each is marked synced as it succeeds
  And a failure of one does not block the others

Scenario: Sync while the app is closed
  Given I have queued collections and close the app
  When the device regains connectivity
  Then Background Sync drains the queue
  And the collections are on the server before I reopen the app
```

### US-053 · Replay creates no duplicates · P0

```gherkin
Scenario: Ambiguous outcome
  Given I record a collection and the request times out after the server processed it
  When the client retries with the same idempotency key
  Then the server returns the original result with 200
  And exactly one collection exists
  And the outstanding reduced only once

Scenario: Key generated at record time
  Given a collection is recorded offline
  Then its idempotency key is generated at that moment
  And the same key is used for every retry attempt
```

> The second scenario matters more than it looks: a key generated at send time produces a new key per retry, which is exactly the duplicate the mechanism exists to prevent.

### US-054 · Honest sync status · P0

```gherkin
Scenario: Three states are distinguishable
  Given I have recorded collections today
  Then each shows one of: saved on device, syncing, or synced to office
  And an offline indicator is visible while disconnected
  And a count of unsynced entries is always visible
```

### US-055 · Late sync reopens a closed day · P1

```gherkin
Scenario: Sync after close
  Given Line 3 closed for today at 6pm
  When a Junior's phone syncs a collection for today at 9pm
  Then the collection is accepted with today's business date
  And the day close reopens and recomputes
  And the Senior is notified that the tally has changed
```

### US-056 · Device storage limits · P2

Warn at 100 unsynced entries; block new entries beyond a hard limit with instructions to find connectivity.

---

## E07 — Day Close and Cash (M08)

### US-060 · Close the day for a line · P0

```gherkin
Scenario: Closing summarises the line
  Given Line 3 expected 4,500 today and collected 4,320
  When the Senior closes the day
  Then expected, collected and a shortfall of 180 are shown
  And every LOW, EXTRA, NO_PAYMENT and MISSED entry is listed
  And collections for that date are locked

Scenario: Cannot close with unsynced devices
  Given a Junior on my line has unsynced collections
  When I attempt to close
  Then I am warned which Juniors have not synced
  And I may close anyway, accepting a later reopen
```

### US-061 · Hand over cash with a denomination count · P0

```gherkin
Scenario: Junior hands cash to Senior
  Given I collected 4,320 today
  When I initiate a handover
  Then I enter counts per denomination
  And the total is computed from the counts
  And the system compares it to my recorded 4,320

Scenario: Discrepancy is recorded, not blocked
  Given my denominations total 4,300 against 4,320 recorded
  When I submit
  Then a discrepancy of -20 is recorded
  And the handover is flagged for the Senior's attention
  And I am not prevented from submitting
```

> Blocking a short handover would mean the cash never gets recorded as moving. Recording the discrepancy is what makes it traceable.

### US-062 · Acknowledge a handover · P0

Cash has not moved until acknowledged; the ledger posts on acknowledgement (BR-17, BR-18).

### US-063 · Dispute a handover · P1

Either party may dispute with a note; escalates to Admin.

### US-064 · Senior hands over to Admin · P0

Second hop, same mechanism.

### US-065 · Investigate a discrepancy · P1

Trace from a line discrepancy to the specific handover and denomination breakdown.

---

## E08 — Notifications (M10)

### US-070 · Notification centre · P1

Role-scoped list with unread badge, categorised `INFORMATION` / `SUCCESS` / `WARNING` / `ALERT` (PDF §24); each deep-links to its subject.

### US-071 · Push notifications · P1

```gherkin
Scenario: Provider follows configuration
  Given the push provider is configured as WEB_PUSH
  When a notification is raised for me
  Then it is delivered via Web Push to my registered devices
  And switching the env to FCM changes delivery with no code change

Scenario: Delivery to all devices
  Given I have two registered devices
  Then each receives the notification independently
  And failure on one does not prevent the other

Scenario: Push failure does not lose the notification
  Given push delivery fails permanently
  Then the notification still appears in my in-app centre
  And the failed subscription is deactivated after repeated failures
```

### US-072 · Senior alerts · P0

Low, extra, no-payment, missed, account completion, new assignment, discrepancy — scoped to their line (PDF §12).

### US-073 · Notification preferences · P2

Per-category opt-out. `ALERT` cannot be disabled.

---

## E09 — Dashboards and Reports (M11, M12)

### US-080 · Super Admin overview · P1

```gherkin
Scenario: The primary question is answered immediately
  When I open the dashboard on my phone
  Then today's expected, collected, shortfall and surplus are visible without scrolling
  And totals for sectors, lines, customers, active and completed accounts are shown
  And account amount, invested and profit totals are shown

Scenario: Every figure drills down
  When I tap today's collected total
  Then I see the sector breakdown
  And I can descend to line, then customer, then individual collections
```

> PDF §17 lists thirteen figures. Fitting them above the fold on a phone is a design problem, not a data problem — the screen specs resolve it by ranking, not by dropping any.

### US-081 · Sector comparison · P1

§18 and §19 — line count, customers, amounts, and how many sectors tallied, had extra, had low collection.

### US-082 · Admin operational dashboard · P1

§21 — new and active customers, completed accounts, sector and line breakdowns, collection status, assignments, investment and profit.

### US-083 · Senior line dashboard · P1

One line: today's expected and collected, each Junior's progress, open alerts, accounts nearing completion, overdue accounts.

### US-084 · Line-wise report · P1

§14 — sector, Senior, Juniors, customers, account count and value, invested, profit, expected, actual, pending, extra, completed.

### US-085 · Investment overview · P1

§22 — per line and overall: account amount, invested, profit.

### US-086 · Collection report · P1

Date range, filterable by line, sector, Junior, classification.

### US-087 · Overdue report · P1

Accounts past target completion, ordered by outstanding and days overdue.

---

## E10 — Audit and Administration (M13, M15)

### US-090 · Audit log · P0

Every create, update, approve, reject, login and day reopen recorded with actor, before/after, IP and timestamp. **Append-only and visible to no role as editable.**

### US-091 · Investigate an account's history · P1

Full chronological trail — creation, disbursement, every collection, adjustments, approvals, completion.

### US-092 · Manage staff · P1

Create, suspend, reset credentials. Role change is Super Admin only.

### US-093 · Declare holidays · P1

Business-wide or per sector; future dates only; regenerates affected schedules and notifies.

### US-094 · Business settings · P2

Super Admin only, audited.

### US-095 · Nightly reconciliation · P0

```gherkin
Scenario: Cached balances are verified
  When the nightly reconciliation runs
  Then every account's collectedAmount is compared to the ledger
  And every ledger account's cached balance is recomputed
  And any mismatch raises an ALERT to Super Admin and Admin
  And the discrepancy is written to the audit log
```

> This is the safety net for every denormalised figure in the system. Without it, a cache drift is silent and compounds.

---

## Summary

| Epic                         | Stories | P0     |
| ---------------------------- | ------- | ------ |
| E01 Identity and Access      | 5       | 2      |
| E02 Organisation             | 6       | 3      |
| E03 Customers                | 5       | 1      |
| E04 Accounts                 | 7       | 6      |
| E05 Collections              | 6       | 3      |
| E06 Offline                  | 7       | 5      |
| E07 Day Close and Cash       | 6       | 3      |
| E08 Notifications            | 4       | 1      |
| E09 Dashboards and Reports   | 8       | 0      |
| E10 Audit and Administration | 6       | 2      |
| **Total**                    | **60**  | **26** |

**Where the risk concentrates:** E06 (Offline) is five P0 stories and the highest technical risk in the project. E04 and E05 carry the money correctness. E09 has no P0 stories at all — dashboards are how the business _sees_ the data, but nothing is lost if they arrive late, whereas a collection that fails to record is gone.
