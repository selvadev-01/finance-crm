# ADR-0018 — Books: expenses, bank accounts, owner drawings, other income and manual journals

**Status:** Accepted · **Date:** 2026-09-24 · **Revises:** [M09](../../01-product/modules/M09-ledger.md#operations) — "no human-initiated posting endpoint exists"

> The migrations for slice 1 (`20260925100000_books_ledger_types` and the two after it) cite this decision as "ADR-0017" in their comments, written before the number was checked. They are applied and are not edited; this is the decision they mean.

## Context

The ledger records only what the loan business posts itself: disbursements, collections, corrections, handovers, write-offs and capital. The owner asked for "a proper ledger, expense tracking fully, not reports only": salary, rent and petrol; a bank account; money the owner takes out; income that is not a collection; an accountant's correcting entry; and a profit and loss and balance sheet.

## Decision

**The books sit beside the loan book, in the same ledger, under the same invariants** — every posting balanced (ADR-0006), append-only, written with its source row and audit entry in one transaction.

- **New ledger account types:** `EXPENSE` (debit-normal, **one per expense category**, keyed by `expenseCategoryId`), `BANK` (debit-normal, **one per bank account**, keyed by `bankAccountId`), `OTHER_INCOME` (credit-normal, one per organization) and `OWNER_DRAWINGS` (debit-normal, one per organization). The keyed ones follow `CASH_IN_HAND` and `LOAN_RECEIVABLE`: an iff CHECK, a partial unique index, and a trigger holding the reference to the account's own organization.
- **New transaction types:** `EXPENSE`, `BANK_TRANSFER`, `DRAWINGS`, `OTHER_INCOME`, `JOURNAL`. A books posting never reuses `ADJUSTMENT`, which the investment movement report reads as money returned.
- **Expense categories** are a starter list per organization (Salary, Rent, Fuel & travel, Phone & internet, Stationery & printing, Bank charges, Interest paid, Miscellaneous) that the Super Admin adds to, renames and retires. **Bank accounts** are the Super Admin's too. Neither is ever deleted, and a bank is not retired while it holds money.
- **Expenses** are paid from office cash or a bank (recorded by an Admin) or from a staff member's cash in hand (a field expense, requested by a Senior or Junior and approved before it posts). **Nobody approves money they spent:** a Junior's goes to their line's Senior or an Admin, a Senior's own to an Admin. An approved field expense reduces what that person owes at handover, so it never shows as a shortfall.
- **Manual journals** are the Super Admin's alone, and **barred from `LOAN_RECEIVABLE`, `UNEARNED_PROFIT`, `EARNED_PROFIT` and `CASH_IN_HAND`**: the nightly reconciliation checks those against the loan book and the collections, and a hand entry there would flag every night, unclearably.
- **Statements** — profit and loss, balance sheet, account statement and cash book — are read from the entries, as the trial balance is.

M09's rule that "no human-initiated posting endpoint exists" becomes: **no endpoint posts arbitrary lines except the Super Admin's restricted journal**; every other books entry is a business event whose own module posts it, as disbursement and capital already were.

## Consequences

- The ledger can answer "what did the business spend, earn and keep" to the paisa, and the trial balance still balances by construction.
- Five slices deliver it: foundation (types, categories, banks), office money (expenses, transfers, other income, drawings), field expenses (the cash-maths change in handovers, day close and the discrepancy report), statements, and journals. All five were built by 2026-10-01; status per story is in the [backlog](../../06-delivery/backlog.md#books--expenses-banks-drawings-journals-statements-adr-0018).
- **Settled while building slices 4 and 5 (2026-10-01):** reading a statement or cash book never creates a ledger account (a place nothing moved through has an empty book), so a GET writes nothing; and a journal's lines are not stored twice — the `journal_entry` row is a header, and the lines are the entries of its one `JOURNAL` transaction.
- Field expenses touch the most sensitive arithmetic in Rasi — what a Junior owes. That slice changes the handover's owed amount, the day close's discrepancy (one helper replacing four copies) and the discrepancy report together, so they cannot disagree.
- **Settled while building slice 3 (2026-10-01):**
  - **The hop is stored, not inferred.** An expense records which handover it comes out of (`expense.hop`) when it is asked for. A Junior's lowers the line's day; a Senior's only what they take to the office. Reading the spender's role later would let a promotion rewrite old tallies.
  - **The database holds the formula.** `day_close` stores `expenseTotal`, and its derivation CHECK became `discrepancy = cashReceivedTotal + expenseTotal − collectedTotal`.
  - **A decision re-tallies; it does not reopen.** BR-16a reopens a closed day when recorded money lands on it. An expense decision changes no recorded money, only how the cash is accounted for, so it refreshes the stored figures and the `TALLIED` / `CLOSED` status instead. The plan had named `moneyWritten`; that would have made the Senior close the day a second time for an approval.
  - **A pending expense counts for nothing.** Until it is approved, the cash is still owed, so a Junior who hands over before approval reads short. The screens say so rather than guessing.
