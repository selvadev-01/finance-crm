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
**Write-off** — remaining receivable and unearned profit cleared against a loss account.

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

## Risks

| Risk                                            | Mitigation                                                             |
| ----------------------------------------------- | ---------------------------------------------------------------------- |
| Ledger and state diverge                        | Same-transaction commitment; nightly reconciliation                    |
| Rounding leaves residual unearned profit        | Rounding on the running total cannot leave a residue; verified nightly |
| Polymorphic source has no referential integrity | Accepted — guaranteed by co-commitment; reconciliation detects orphans |
| Balance cache drifts                            | Recomputed nightly from entries, which are immutable                   |
| An imbalanced transaction is written            | Database trigger makes it impossible, not merely unlikely              |
