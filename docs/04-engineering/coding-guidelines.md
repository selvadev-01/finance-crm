# Coding Guidelines

Rules that carry a reason. Formatting is delegated to tooling and not discussed here — Prettier formats, the linters decide, nobody argues in review.

**The organising principle:** this system handles other people's money and runs offline in the field. Where a rule trades convenience for correctness, correctness wins — and where a mistake can be made structurally impossible rather than merely discouraged, make it impossible.

**The checks:** `pnpm lint` (ESLint in `web` and `ui`, oxlint in `api`), `pnpm check-types`, `pnpm test` (Vitest), `pnpm format`. Several rules below reference packages that do not exist yet — [`project-structure.md`](project-structure.md#not-yet-present) says which. Write new code so the rules hold from its first line.

---

## The non-negotiables

Five rules. Violating any of these is a blocking review comment, and each has a lint rule or a test behind it.

### 1. No floating point in the money path

```ts
// ✗ never
const total = collections.reduce((s, c) => s + Number(c.amount), 0);
const variance = amount - expected;

// ✓ always
const total = collections.reduce((s, c) => s.plus(c.amount), new Decimal(0));
const variance = new Decimal(amount).minus(expected);
```

Applies at every layer including the frontend. Amounts cross the API as **decimal strings** and are parsed into `Decimal`, never `Number` (BR-11, [ADR-0009](../02-architecture/adr/0009-decimal-money-stored-dates.md)).

> A custom ESLint rule flags arithmetic operators applied to anything typed as a money field. It produces occasional false positives; that is an acceptable price.

### 2. Money writes and their ledger postings share one transaction

```ts
await prisma.$transaction(async (tx) => {
  const collection = await tx.collection.create({ ... });
  await tx.ledgerEntry.createMany({ ... });   // same tx
  await tx.notification.create({ ... });      // same tx
  await boss.send("push-dispatch", { ... }, { db: tx });  // same tx
});
```

The ledger can never record a collection that rolled back, and a committed collection can never be missing its posting (BR-18).

### 3. No unscoped queries

Every repository method takes a `RequestContext`. There is no default and no optional parameter.

```ts
// ✗ the scoping is invisible and forgettable
async findCollections(lineId: string) { ... }

// ✓ scoping is structural
async findCollections(ctx: RequestContext, filters: CollectionFilters) { ... }
```

> Scoping enforced in controllers is a rule every future endpoint must remember. Enforced where queries are built, an unscoped query is something you have to write deliberately.

### 4. Collections are never updated

No `update` or `delete` on the collection repository. Corrections insert an `ADJUSTMENT` row (BR-14). If you find yourself wanting to change a collection, you want [`createAdjustment`](../01-product/modules/M07-collections.md#corrections).

### 5. Business dates come from one function

```ts
// ✗
const businessDate = new Date().toISOString().slice(0, 10);

// ✓
const businessDate = toBusinessDate(capturedAt);
```

`toBusinessDate` in `packages/domain` is the only place a timezone conversion happens (BR-12).

---

## Package boundaries

| Package | May import | Must not import |
| --- | --- | --- |
| `packages/domain` | Nothing but `decimal.js` and date utilities | **Prisma, NestJS, anything framework** |
| `packages/contracts` | Zod | Prisma, NestJS |
| `packages/db` | Prisma | Application code |
| `apps/api` | All packages | `apps/web` |
| `apps/web` | `contracts`, `ui`, `domain` | `db`, `apps/api` |

Enforced by lint import rules, not convention. `apps/web` and `packages/ui` lint with the shared flat configs in `@repo/eslint-config`; `apps/api` uses oxlint, so a boundary rule added for one needs adding to the other.

> `packages/domain` being framework-free is the rule with the most leverage. It means schedule generation, working-day arithmetic, variance classification and profit apportionment are testable exhaustively in milliseconds, with no database and no application context. The moment a Prisma import appears there, that property is gone — and it will not come back, because the next contributor will follow the precedent.

---

## NestJS

**`apps/api` is ESM.** Relative imports carry a `.js` extension even in `.ts` files — `import { X } from './x.service.js'`. Omitting it type-checks and then fails at runtime, so it is not a style preference.

**Module structure** — one directory per module (M01–M16):

```
modules/collections/
├─ collections.module.ts
├─ collections.controller.ts
├─ collections.service.ts        business logic
├─ collections.repository.ts     scoped data access
├─ dto/                          re-exported from packages/contracts
└─ __tests__/
```

**Controllers are thin.** Validate, delegate, return. No business logic, no Prisma access.

**Services own business logic** and do not know about HTTP. No `Request`, no `Response`, no status codes.

**Repositories own data access** and take a `RequestContext`.

**Cross-module calls go through events** where the relationship is a reaction rather than a dependency:

```ts
// ✗ M07 reaching directly into notifications
await this.notificationService.createLowCollectionAlert(...);

// ✓ M07 states what happened; interested modules react
this.events.emit(new CollectionConfirmedEvent(collection));
```

> Direct calls make M07 responsible for knowing every consequence of a collection. Events mean adding a new reaction — a new alert, a new report trigger — does not touch the collection module at all. Audit coverage in particular becomes a property of the event bus rather than a discipline each module must remember (M13).

Direct injection is correct where the dependency is genuine: M05 calls M06 for working-day arithmetic, because it cannot proceed without the answer.

---

## Next.js

**Server Components by default.** `'use client'` only where interactivity requires it, and as deep in the tree as possible.

**The Junior's route is client-heavy** — it must work offline, which server rendering cannot provide. That is the exception, and it is deliberate.

**TanStack Query for server state, `useState` for UI state.** No global store for data that belongs to the server.

**Forms:** react-hook-form with the Zod schema from `packages/contracts`, so client validation is the server's validation rather than a second implementation that drifts.

**Never render a money value with `toFixed`.** Use the shared `formatCurrency` helper, which takes a decimal string and applies Indian grouping.

---

## TypeScript

**`strict: true`.** No exceptions.

**No `any`.** `unknown` plus narrowing. `// eslint-disable` on a type error requires a comment explaining why, and review will ask.

**No non-null assertions (`!`)** in application code. If a value can be absent, handle absence. Permitted in tests and in config loading where startup validation has already guaranteed presence.

**Prefer discriminated unions to optional fields:**

```ts
// ✗ four states, sixteen representable combinations, twelve of them invalid
type Result = { ok?: boolean; data?: X; error?: string };

// ✓ three states, exactly three representable
type Result =
  | { status: "ok"; data: X }
  | { status: "retry"; reason: string }
  | { status: "failed"; reason: string };
```

**Type money as `Decimal`, never `number`.** A branded `Money` type would be better still and is a candidate for later.

---

## Naming

Follow the [glossary](../00-overview/glossary.md) exactly. The domain vocabulary is precise and code that renames it creates a translation layer in every reader's head.

| Concept | Code | Never |
| --- | --- | --- |
| A loan | `AccountLoan`, `accountLoanId` | `loan`, `account` |
| Ledger account | `ledgerAccount` | `account` |
| Auth account | `account` (Better Auth's) | — |
| Collection day | `collectionDay`, `workingDay` | `businessDay` |
| Business date | `businessDate` | `date`, `collectionDate` |
| Expected amount | `expectedAmount` | `dueAmount`, `target` |
| Variance | `variance` | `difference`, `delta` |

> "Account" is the dangerous one. It means a loan in the product, an OAuth link in Better Auth, and a bookkeeping account in the ledger. Bare `account` in Rasi code always means Better Auth's table; the other two are always qualified.

**Booleans read as assertions:** `isOverdue`, `hasUnsyncedEntries`, `canApprove`. Not `overdue`, not `syncFlag`.

**Async functions that fetch are `get*` or `find*`.** `find*` may return null; `get*` throws when absent.

---

## Errors

Throw typed domain errors; never return error strings, and never throw bare `Error` in a service.

```ts
throw new DomainError(
  "ACCOUNT_INVESTED_EXCEEDS_AMOUNT",
  "Invested amount must be below the account amount",
);
```

`code` is stable and machine-readable; `message` may be reworded freely. A global filter maps categories to status codes ([api-design](../02-architecture/api-design.md#errors)).

**Never swallow an error.** An empty `catch` is a blocking review comment. Handle it, wrap it, or let it propagate.

**Never log and rethrow** — it produces the same error twice in the logs with two different stack contexts. Log at the boundary, or rethrow with context.

---

## Comments

Comment **why**, not what. Code says what it does; comments explain what the code cannot.

```ts
// ✗
// increment the attempt counter
attempts += 1;

// ✓
// Generated here, at record time, rather than at dispatch: a key created
// per-attempt would produce a new key on every retry, which is exactly the
// duplicate this mechanism exists to prevent (BR-13).
const idempotencyKey = crypto.randomUUID();
```

**Reference rule IDs.** `BR-07`, `ADR-0005` — they connect code to the decision behind it, and the decisions are written down.

**No commented-out code.** Delete it. Code that is kept "in case" rots silently and misleads the next reader about what the system does.

---

## Testing

The testing rules that belong in this document:

**Every money rule has a test with the PDF's own figures** — ₹10,000 / ₹8,500 / ₹1,500 / ₹100 — plus its shortfall and overpayment variants.

**Every job handler has a run-twice test** asserting identical state. pg-boss guarantees at-least-once delivery, so idempotency is a requirement rather than a nicety.

**Every RBAC matrix cell is an API-level test** asserting the actual HTTP status. Verifying a hidden button is not coverage.

**Test names state the behaviour**, not the method:

```ts
// ✗ it("createAccount works")
// ✓ it("rejects an account whose term cannot clear the balance")
```

---

## Database

**A migration is never edited once it has been applied anywhere but your own machine.** A mistake is corrected by a new migration.

**Every money column is `Decimal @db.Decimal(14,2)`.**

**Every foreign key has an index.** Postgres does not create one automatically, and the absence surfaces as a slow join months later.

**Constraints belong in the database** where they are invariants, not only in the application. The ledger's balancing trigger and `profitAmount = accountAmount - investedAmount` are database-level for the same reason: an application check is skippable by the next person in a hurry.

**No raw SQL with interpolation.** Prisma parameterises; `$queryRaw` requires a review comment justifying it.

---

## Logging

Structured, via the injected logger. Never `console.log`.

```ts
this.logger.info({ collectionId, accountLoanId, amount: amount.toString() },
  "collection confirmed");
```

**Money as strings in logs**, so a log line cannot introduce float drift into an investigation.

**Never log** passwords, tokens, session cookies or push subscription keys. Redaction is allowlist-based (M16) — a denylist is a list of the leaks you thought of.

---

## Review checklist

- [ ] Money uses `Decimal` end to end, including the frontend
- [ ] Money writes share a transaction with their ledger postings
- [ ] Repository methods take `RequestContext`
- [ ] No collection update or delete path introduced
- [ ] Business dates come from `toBusinessDate`
- [ ] Package boundaries respected
- [ ] New job handlers are idempotent, with a run-twice test
- [ ] New endpoints have RBAC tests for **every** role, not just the happy path
- [ ] Domain vocabulary matches the glossary
- [ ] Errors are typed and carry stable codes
- [ ] Nothing sensitive reaches a log
- [ ] Rule IDs referenced where a decision is encoded
