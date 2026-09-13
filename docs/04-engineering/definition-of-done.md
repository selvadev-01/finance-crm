# Definition of Done

A story is done when a Junior could use it tomorrow and nobody would be surprised by what happens.

---

## Every story

- [ ] Acceptance criteria from [`user-stories.md`](../01-product/user-stories.md) all pass
- [ ] Unit tests for new logic; integration tests for new endpoints
- [ ] **RBAC tests for every role**, not just the happy path
- [ ] `pnpm lint`, `pnpm check-types` and `pnpm test` all pass from the repository root
- [ ] Reviewed and approved
- [ ] Domain vocabulary matches the [glossary](../00-overview/glossary.md)
- [ ] Documentation updated where behaviour changed
- [ ] No `TODO` without a tracked issue

---

## Additional, by kind of work

### Touching money

- [ ] `Decimal` end to end, including the frontend
- [ ] Ledger postings share a transaction with the state change
- [ ] Worked example test using the PDF's figures (₹10,000 / ₹8,500 / ₹1,500 / ₹100)
- [ ] Shortfall and overpayment paths both tested
- [ ] The relevant `BR-nn` is referenced in code, at the line that encodes it
- [ ] Nightly reconciliation still passes against a seeded month

### Touching collections

- [ ] No update or delete path introduced
- [ ] Idempotency key respected
- [ ] `lineId`, `collectedByUserId`, `expectedAmount`, `businessDate` frozen at write
- [ ] Offline path tested, not only the online one

### Touching offline sync

- [ ] Works with the network disabled for the whole flow
- [ ] Queue survives app close and device restart
- [ ] Replay after an ambiguous outcome creates exactly one row
- [ ] `401` mid-sync retains the queue
- [ ] Sync state visible and accurate throughout
- [ ] **Tested on a real mid-range Android device**, not only in a desktop emulator

### Adding an endpoint

- [ ] Contract added to `packages/contracts`
- [ ] Repository method takes `RequestContext`
- [ ] Every RBAC matrix cell tested at API level
- [ ] Out-of-scope rows return `404`, not `403`
- [ ] Pagination on list endpoints; date bounds on reports
- [ ] Errors typed, with stable codes

### Adding a job

- [ ] Handler is idempotent, with a **run-twice test**
- [ ] Singleton key prevents overlap
- [ ] Timezone declared explicitly
- [ ] Cron expression in settings, not code
- [ ] Failure logs structured context
- [ ] Dead-letter path verified

### Schema change

- [ ] Migration reviewed for backward compatibility with the running version
- [ ] Foreign keys indexed
- [ ] Money columns `Decimal(14,2)`
- [ ] Invariants expressed as database constraints, not only application checks
- [ ] If anything is dropped or renamed, the order the change must be applied in is written down
- [ ] Seed data updated
- [ ] [`data-dictionary.md`](../03-data/data-dictionary.md) updated

### UI

- [ ] Works at 360px width
- [ ] Keyboard accessible; visible focus states
- [ ] Loading, empty and error states all implemented
- [ ] Money formatted via `formatCurrency`, never `toFixed`
- [ ] No data the role may not see — verified against the [RBAC matrix](../01-product/rbac-matrix.md), including in push payloads

---

## Not done

Stated plainly, because these are the ways work gets called finished when it is not:

| Claim                                | Reality                                                                          |
| ------------------------------------ | -------------------------------------------------------------------------------- |
| "Works on my machine"                | The only machine there is — so run the full suite on it, not just the unit tests |
| "Unit tests pass"                    | Not run against the `test` schema                                                |
| "I'll add tests after"               | Not done                                                                         |
| "The button is hidden for that role" | Not an access control — the API must refuse it                                   |
| "It works online"                    | The offline path is the requirement, not the fallback                            |
| "Rounding is close enough"           | A paisa of drift compounds across 150,000 collections                            |
| "I'll write the ADR later"           | The reasoning is gone by then                                                    |

---

## Release gates

Beyond individual stories, v1 is not complete until all six [PRD release gates](../01-product/prd.md#release-gates) pass, verified by a dedicated pre-release suite:

1. A Junior completes a full route offline; every collection syncs exactly once
2. The ledger balances after a simulated month including corrections and reversals
3. Every account's `collectedAmount` reconciles to the ledger
4. A line closes, hands over cash, and tallies to zero discrepancy
5. Every role sees only its permitted data — verified at API level
6. A **mid-term account** — past disbursement date, collected-to-date balance — behaves identically to one created from day zero

> Gate 6 matters because there is no data import. Every customer entered at launch is already partway through their term, so an account created on day 47 must compute its schedule, target date and outstanding exactly as one created on day 1.

Hosting, backups and release process are deferred until the application is built.
