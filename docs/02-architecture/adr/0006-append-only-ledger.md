# ADR-0006 — Append-only collections and a double-entry ledger

**Status:** Accepted · 2026-09-12

## Context

Rasi replaces a Google Sheet where any cell could be changed by anyone, at any time, with no record. In a business where cash passes through three pairs of hands daily, that is the largest single risk — and the source document does not address it: §19 mentions a "daily tally" without saying who holds the cash or how a figure is proven.

The dominant threat is insider alteration of a past record to cover a shortfall ([security](../security.md#threat-model)), not an external attacker.

## Decision

Two structural commitments.

**1. Collections are append-only.** No update or delete route exists. A correction inserts a new `ADJUSTMENT` row referencing the original, gated by approval. The balance is the sum of all confirmed rows. Both records remain visible.

**2. Every money event posts to a double-entry ledger**, in the same database transaction as the state change it describes. A deferred constraint trigger enforces that debits equal credits at commit.

## Consequences

**Good**

- The fraudulent edit **cannot be made**, rather than being detectable afterwards. This is a preventive control where the alternative is detective
- Every total traces to postings, and the postings must balance. A figure that cannot be explained cannot exist
- Profit is recognised proportionally as cash arrives, so the Super Admin's profit figure reflects money received rather than money hoped for
- Corrections are visible as corrections — the history of what was recorded is preserved alongside what is true now
- The ledger is an independent check on every denormalised balance, verified nightly

**Bad**

- More rows. Each collection writes a collection record plus two to four ledger entries. At 1,500 collections a day this is trivial storage
- Corrections require an approval workflow, which is friction for a genuine typo
- Balances are caches over the ledger, needing nightly reconciliation to stay trustworthy
- Developers must understand double-entry bookkeeping, which is unfamiliar to many

**Neutral**

- The ledger gives an audit trail that would otherwise need building separately, and makes a future accounting-package export straightforward

## Alternatives considered

**Mutable collections with an audit log.** The common approach, and rejected. An audit log records that a change happened; it does not prevent it, and it is only as good as the discipline of reading it. Nobody reads an audit log daily. Append-only removes the class of problem instead of monitoring for it.

**Soft-delete plus re-entry.** Rejected as append-only with worse ergonomics — it preserves history while making the current balance a filtered query that is easy to get wrong.

**Single-entry running balances.** Rejected. Simpler until the first discrepancy, at which point there is no way to determine where a figure came from. Single-entry is precisely the model the spreadsheet already uses, and its failure is the reason for this project.

**Ledger balancing enforced in application code.** Rejected. An application check is skippable by the next developer in a hurry. A database constraint is not, and this is the one invariant worth a trigger.
