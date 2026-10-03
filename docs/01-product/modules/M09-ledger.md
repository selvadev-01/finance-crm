# M09 — Ledger

**Purpose:** the financial truth. Every rupee, double-entered, append-only.

**Source:** PDF §9, §22, §23. Rule: BR-18.

> The PDF asks for investment and profit at customer, line, sector and business level (§9, §23). A ledger is how those figures become _provable_ rather than merely computed — every total traces to postings, and the postings must balance.

---

## Scope

**In:** ledger accounts, transactions, postings, balances, profit recognition.

**Out:** everything that triggers a posting. The ledger is written to by M05, M07 and M08; it initiates nothing.

---

## Owned entities

`ledger_account` · `ledger_transaction` · `ledger_entry`

All three are **append-only with no update path at all**. A correction is a new transaction. `ledger_entry` has no `updatedAt` because nothing ever updates it.

---

## Ledger accounts

| Type              | Cardinality          | Normal balance |
| ----------------- | -------------------- | -------------- |
| `CASH_IN_HAND`    | One per staff member | Debit          |
| `CASH_AT_OFFICE`  | One                  | Debit          |
| `LOAN_RECEIVABLE` | One per account      | Debit          |
| `CAPITAL`         | One                  | Credit         |
| `UNEARNED_PROFIT` | One                  | Credit         |
| `EARNED_PROFIT`   | One                  | Credit         |
| `WRITE_OFF_LOSS`  | One                  | Debit          |

Created automatically with their owner — a staff member gets a cash account, an account gets a receivable.

---

## Postings

Using the reference figures: `A = 10,000`, `I = 8,500`, `P = 1,500`.

**Disbursement**

| Ledger account               |     Debit |   Credit |
| ---------------------------- | --------: | -------: |
| `LOAN_RECEIVABLE` (customer) | 10,000.00 |          |
| `CASH_AT_OFFICE`             |           | 8,500.00 |
| `UNEARNED_PROFIT`            |           | 1,500.00 |

**Collection of ₹100** — profit recognised proportionally at `P / A = 15%`

| Ledger account               |  Debit | Credit |
| ---------------------------- | -----: | -----: |
| `CASH_IN_HAND` (Junior)      | 100.00 |        |
| `LOAN_RECEIVABLE` (customer) |        | 100.00 |
| `UNEARNED_PROFIT`            |  15.00 |        |
| `EARNED_PROFIT`              |        |  15.00 |

**Handover ₹5,000, Junior → Senior**

| Ledger account          |    Debit |   Credit |
| ----------------------- | -------: | -------: |
| `CASH_IN_HAND` (Senior) | 5,000.00 |          |
| `CASH_IN_HAND` (Junior) |          | 5,000.00 |

**Adjustment** — the reverse of the original, at the original's proportions.

**Write-off ₹10,000 account, ₹100 collected** (US-035, as built 2026-09-20) — outstanding `O` and the unearned profit `U` the account still holds:

| Ledger account    |    Debit |   Credit |
| ----------------- | -------: | -------: |
| `UNEARNED_PROFIT` | 1,485.00 |          |
| `WRITE_OFF_LOSS`  | 8,415.00 |          |
| `LOAN_RECEIVABLE` |          | 9,900.00 |

**Capital ₹50,000 put into the business** (US-032, as built 2026-09-24) — sourced to a `capital_entry` (M08), recorded by a Super Admin:

| Ledger account   |     Debit |    Credit |
| ---------------- | --------: | --------: |
| `CASH_AT_OFFICE` | 50,000.00 |           |
| `CAPITAL`        |           | 50,000.00 |

After one disbursement of `I = 1,700`, office cash goes from `−1,700.00` to `48,300.00`. The transaction type is `CAPITAL`, so the dashboards' invested, collected and profit figures — which read `DISBURSEMENT`, `COLLECTION` and `ADJUSTMENT` postings only — never count it.

`WRITE_OFF_LOSS` is a sixth business-wide account, one per organization and **debit-normal** like the expense it is (migrations `ledger_write_off_loss` and `constraints_ledger_write_off_loss`). The loss is `O − U`: what the business actually put out and did not get back. Profit already earned on what _was_ collected stays earned — the ₹15 above.

**Only `WRITTEN_OFF` posts** (decided 2026-09-20). `DEFAULTED` stops collection and leaves the receivable standing, because the money is still owed and may still be recovered; a defaulted account can be written off later.

---

## Proportional profit recognition

Profit is earned as money arrives, not at disbursement.

> An account half collected shows roughly half its profit. Recognising the full ₹1,500 at disbursement would make the Super Admin's profit figure a statement of hope rather than fact — it would count profit on money that may never arrive. Proportional recognition is what makes §22's investment overview meaningful.
>
> **Rounding is applied to the running total** (BR-18). Each collection or adjustment posts `round(collectedAfter × P/A) − round(collectedBefore × P/A)`, half-up to the paisa. When the account is fully collected, earned profit is exactly `P` and `UNEARNED_PROFIT` lands at zero — no "final collection" logic exists. This is still checked by the nightly reconciliation.

Implemented in `packages/domain` (`src/ledger/profit.ts`): `profitForCollection({ accountAmount, profitAmount, collectedBefore, amount })` returns the amount to post — debit `UNEARNED_PROFIT` / credit `EARNED_PROFIT` when positive, the reverse when negative, no profit lines when zero. `recognisedProfit` and `unearnedProfit` give the balances for a collected total; `unearnedProfit` is the amount a write-off clears. A total outside `0…A` throws. The mid-term catch-up posting (US-030a) is `profitForCollection` with `collectedBefore = 0`, which yields exactly what a day-one account's individual collections would have earned.

⚠️ **Corrected during implementation.** This note previously said the final collection absorbs the accumulated difference. The running-total method was chosen instead; see BR-18.

---

## Two invariants, enforced at the database

**1. Every transaction balances.** A deferred constraint trigger verifies Σ debits = Σ credits at commit time.

> An application-level check is skippable by the next developer in a hurry. A constraint is not. This is the one place in the system where "it cannot be written incorrectly" is worth the cost of a trigger.

**2. Ledger writes commit with their source.** A ledger transaction is written inside the same database transaction as the state change it describes (BR-18) — so the ledger can never record a collection that rolled back, and a committed collection can never be missing its posting.

This is also why `sourceTable` + `sourceId` is a deliberate polymorphic reference without a foreign key: the integrity guarantee comes from transactional co-commitment, not from a constraint.

---

## Balances

`ledger_account.balance` is a cache, recomputable at any time by summing entries. The nightly job (M14) rebuilds every balance, compares, and alerts on mismatch — the same job that verifies `account_loan.collectedAmount`.

> This reconciliation is the safety net under every denormalised figure in the system. Without it, cache drift is silent and compounds. With it, a wrong number surfaces the next morning rather than at year end.

---

## Operations

| Operation                         | Actor                                                        |
| --------------------------------- | ------------------------------------------------------------ |
| View ledger accounts and balances | Admin+                                                       |
| View transactions and entries     | Admin+                                                       |
| Trial balance report              | Admin+                                                       |
| Post a transaction                | **System only** — no human-initiated posting endpoint exists |

Seniors cannot read the ledger: cash and capital account balances would let them infer business-wide figures they are not permitted to see.

---

## Events

**Consumed:** `account.disbursed` (M05), `collection.confirmed` and `collection.adjusted` (M07), `handover.acknowledged` (M08), `account.written_off` (M05).

**Emitted:** `ledger.imbalance_detected` (→ M10, Super Admin alert) — should never fire.

---

## As built

`apps/api/src/ledger/ledger.service.ts` is the only writer of ledger rows. Postings are system-only, so the module's one controller only reads.

**Trial balance** (2026-09-24): `GET /api/ledger/trial-balance?date=` (`ledger.view`, Admin and above), in `trial-balance.service.ts`. It is read from the **entries**, never the `balance` caches, up to a business date (today by default). Each ledger account's debits and credits net to one balance on whichever side it falls. Cash in hand is one row per staff member, named. Every other type is one row, and the loan receivables row carries its account count. The totals of the two sides are compared, and `balanced` false is reported on screen as a fault, never adjusted. A Senior gets no rows (`seesOrganizationLedger`). The console shows it at `/reports/trial-balance`, listed on the reports index for Admins only. Worked example in `test/ledger/trial-balance.service.spec.ts`: 5,300.00 on each side, 2,000.00 as of the day before, a drifted cache ignored, organizations kept apart. **Postings** (2026-09-24): `GET /api/ledger/transactions?from=&to=&type=` (`ledger.view`), in `ledger-transactions.service.ts` — M09's "view transactions and entries". Every posting over a date range, newest first, paged, optionally one transaction type, each with its entries debits first (which account, whose cash, which loan, how much) and its amount. A transaction carries no organization, so it belongs to the organization whose ledger accounts its entries post to. The console shows it at `/reports/trial-balance/postings`, linked from the trial balance for that date's month, with each posting linked to the account or collection that caused it. Proven in `test/ledger/ledger-transactions.service.spec.ts`: the three postings of the worked example with their entries, the type and date filters, paging without repeats, organizations kept apart.

- **`post(context, posting)`** refuses to run outside a `Database.transaction`. It drops zero lines, refuses negative ones, writes the transaction and its entries, and moves each account's `balance` cache, signed by its normal balance. Balancing is left to the deferred trigger (ADR-0006).
- **`organizationAccount(organizationId, type)`** returns the organization's `CASH_AT_OFFICE`, `CAPITAL`, `UNEARNED_PROFIT` or `EARNED_PROFIT` account. It creates one with `INSERT … ON CONFLICT DO NOTHING` against the one-per-organization partial index, so concurrent first uses neither fail nor abort the caller's transaction.
- **`createReceivable(organizationId, accountLoanId)`** creates an account's `LOAN_RECEIVABLE`.
- **`organizationAccount` also serves `WRITE_OFF_LOSS`** (US-035), the one debit-normal business-wide account.

**A write-off changes what a receivable balance means, and its readers were updated with it (2026-09-20).** The collected figure is inferred everywhere as `A − receivable balance`, which a write-off would inflate to the whole account amount — money that never arrived. Both readers now subtract what the `WRITE_OFF` posting credited to that receivable:

- the **nightly reconciliation** (US-095), which would otherwise report every written-off account as a mismatch every night, unclearably; it expects no unearned profit for one, since the write-off cleared it;
- the **investment overview's position** (US-085), which would otherwise show a written-off account as fully repaid with all its profit earned. A write-off is deliberately not _movement_: nothing came back.

**Decided 2026-09-13: ledger accounts carry `organizationId`** (migration `ledger_account_organization`). Before this, the business-wide accounts had no owner at all.

Posting so far:

- **Disbursement** (M05, US-032).
- **The mid-term catch-up** (US-030a): one COLLECTION transaction sourced to the `account_loan`, debiting `CASH_AT_OFFICE`, with no collection row behind it.
- **Collection and adjustment** (M07), **handover** (M08), **write-off** (US-035) and **capital** (M08, US-032).

**Capital funds office cash** (US-032, 2026-09-24): `CapitalService` in M08 posts `CAPITAL` transactions, debit `CASH_AT_OFFICE`, credit `CAPITAL`, with its `capital_entry` in the same transaction. Since 2026-10-02 a day-one disbursement is refused when office cash holds less than its invested amount (`INSUFFICIENT_CASH_IN_HAND`, [M05](M05-accounts.md)), and since 2026-10-03 a mid-term account is refused when office cash holds less than its invested amount less its collected-to-date. So office cash goes negative only through office expenses and drawings, or through mid-term accounts entered before that date; Books flags it. An approved field expense is likewise refused when the spender's `CASH_IN_HAND` holds less than it ([M08](M08-day-close-cash.md)). Still no human posts a ledger transaction directly: capital, like a disbursement, is a business event whose module posts it.

**Books (ADR-0018, from 2026-09-25).** Four more account types — `EXPENSE` (one per expense category), `BANK` (one per bank account), `OTHER_INCOME` and `OWNER_DRAWINGS` — and five transaction types for the business's own money: `EXPENSE`, `BANK_TRANSFER`, `DRAWINGS`, `OTHER_INCOME`, `JOURNAL`. `LedgerService.expenseAccount` and `bankAccount` create the keyed accounts on first use, conflict-safe like `cashInHand`. The trial balance and postings name each category and bank. Slices 1 and 2 are built: categories, banks and the ledger shape; then `BooksMoneyService` (`src/books/books-money.service.ts`), which records an office expense (debit the category's `EXPENSE`, credit `CASH_AT_OFFICE` or the `BANK`), a bank transfer, other income (debit the place, credit `OTHER_INCOME`) and a drawing (debit `OWNER_DRAWINGS`, credit the place), each with its source row and audit entry in one transaction. So since slice 2 **people do record the business's own money** — but always as a typed business event whose module posts it, never as a free-form posting; the free-form journal is slice 5, the Super Admin's only, and barred from the accounts reconciliation checks. Slice 3 posts approved field expenses (debit `EXPENSE`, credit the spender's `CASH_IN_HAND`). Status is in the [backlog](../../06-delivery/backlog.md).

**Manual journal (slice 5, built 2026-10-01).** The one free-form posting, and the Super Admin's alone (`journal.post`): `POST /api/journal-entries` writes a `journal_entry` header and a `JOURNAL` transaction of 2–20 balanced lines. The lines may name office cash, a bank, an expense category, other income, capital, drawings or write-off loss — **never** `CASH_IN_HAND`, `LOAN_RECEIVABLE`, `UNEARNED_PROFIT` or `EARNED_PROFIT`, which the reconciliation checks against the loan book and the collections; the contract cannot even express them. Those change only through the business event that keeps the loan book in step (a correction, a handover, a write-off).

**Statements (ADR-0018 slice 4, built 2026-10-01).** `StatementsService` reads the entries, as the trial balance does, so every statement agrees with it to the paisa:

- **Profit and loss** over a range: credits less debits on `EARNED_PROFIT` and `OTHER_INCOME`, less debits net on each `EXPENSE` and on `WRITE_OFF_LOSS`. A disbursement is not on it — it turns cash into a receivable — and nor is the principal inside a collection.
- **Balance sheet** at a date: `CASH_AT_OFFICE + BANK + CASH_IN_HAND + LOAN_RECEIVABLE − UNEARNED_PROFIT` against `CAPITAL − OWNER_DRAWINGS + retained profit`, where retained profit is the profit and loss since the books began. Because every posting balances (ADR-0006) the two are equal; `balanced: false` is a defect, as on the trial balance.
- **Account statement** for any one ledger account, and the **cash book** for office cash or a bank: the opening balance, each entry with the running balance on the account's normal side, and the closing balance. Reading never creates a ledger account; a place nothing has moved through has an empty book.

Each has an export (Excel, PDF, CSV), and so now does the trial balance; every export is an `EXPORT` audit entry. Trial balance rows that are one account carry its id and open its statement.

**Reconciliation** (`reconciliation.service.ts`, US-095): for one organization, every ledger account's balance is recomputed from its entries. A cache that disagrees is re-checked under its row lock, rebuilt, and audited as a system action. Every disbursed account's `collectedAmount` is compared with `A − receivable`: a mismatch is audited and reported, and **the account is not changed**, because its balance drives the schedule and completion. `UNEARNED_PROFIT` is compared with the sum of `unearnedProfit` over accounts. Mismatches log at error level; the alert waits for M10.

---

## Risks

| Risk                                            | Mitigation                                                             |
| ----------------------------------------------- | ---------------------------------------------------------------------- |
| Ledger and state diverge                        | Same-transaction commitment; nightly reconciliation                    |
| Rounding leaves residual unearned profit        | Rounding on the running total cannot leave a residue; verified nightly |
| Polymorphic source has no referential integrity | Accepted — guaranteed by co-commitment; reconciliation detects orphans |
| Balance cache drifts                            | Recomputed nightly from entries, which are immutable                   |
| An imbalanced transaction is written            | Database trigger makes it impossible, not merely unlikely              |
