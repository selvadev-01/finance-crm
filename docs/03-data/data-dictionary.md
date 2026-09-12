# Data Dictionary

Column-level reference. Structure and reasoning are in [`erd.md`](erd.md); rules referenced as `BR-nn` are in [`../01-product/business-rules.md`](../01-product/business-rules.md).

**Types** are Prisma types with the PostgreSQL mapping where it differs. `Decimal` is always `@db.Decimal(14,2)` (BR-11). `DateTime @db.Date` is a calendar date with no time component; plain `DateTime` is `timestamptz`.

**Common columns** — present on every domain table unless noted, omitted from the tables below to avoid repetition:

| Column | Type | Notes |
| --- | --- | --- |
| `id` | `String @id @default(cuid())` | |
| `createdAt` | `DateTime @default(now())` | |
| `updatedAt` | `DateTime @updatedAt` | Absent on append-only tables |
| `createdByUserId` | `String?` | Where a human actor is meaningful |

---

## Better Auth tables — generated, do not hand-edit

`user`, `session`, `account`, `verification` are produced by `better-auth generate` and owned by the library. They are listed for completeness only; their shape is Better Auth's to define and may change across versions.

| Table | Purpose |
| --- | --- |
| `user` | Identity — id, name, email, emailVerified, image |
| `session` | Active sessions — token, expiresAt, ipAddress, userAgent |
| `account` | Credential and OAuth provider links. **Not a Rasi loan** — see glossary |
| `verification` | Email verification and password reset tokens |

> Rasi adds no columns to these tables. All staff data lives in `staff_profile`.

---

## Identity and organisation

### `staff_profile`

| Column | Type | Null | Notes |
| --- | --- | --- | --- |
| `userId` | `String` | No | Unique. FK → `user.id`, cascade delete |
| `staffCode` | `String` | No | Unique, human-readable (`JR-0042`) |
| `role` | `StaffRole` | No | `SUPER_ADMIN` \| `ADMIN` \| `SENIOR` \| `JUNIOR` |
| `phone` | `String` | No | E.164. Unique |
| `status` | `StaffStatus` | No | `ACTIVE` \| `SUSPENDED` \| `INACTIVE`. Default `ACTIVE` |
| `joinedAt` | `DateTime @db.Date` | No | |
| `deletedAt` | `DateTime` | Yes | Soft delete; excluded from all queries when set |

Role is single-valued — a person is a Senior or a Junior, not both. Multi-role would complicate every scoping query for a case the business does not have.

### `sector`

| Column | Type | Null | Notes |
| --- | --- | --- | --- |
| `organizationId` | `String` | No | FK → `organization.id` |
| `code` | `String` | No | Unique (`SEC-01`) |
| `name` | `String` | No | |
| `isActive` | `Boolean` | No | Default `true`. Inactive sectors keep history, accept no new lines |

### `line`

| Column | Type | Null | Notes |
| --- | --- | --- | --- |
| `sectorId` | `String` | No | FK → `sector.id` |
| `code` | `String` | No | Unique business-wide, not per sector (`LN-07`) |
| `name` | `String` | No | |
| `isActive` | `Boolean` | No | Default `true` |

A line cannot be deactivated while it has `ACTIVE` accounts — enforced in the service layer, since it needs a count.

### `line_assignment`

Temporal staffing record (BR-15 rationale).

| Column | Type | Null | Notes |
| --- | --- | --- | --- |
| `lineId` | `String` | No | FK → `line.id` |
| `staffProfileId` | `String` | No | FK → `staff_profile.id` |
| `assignmentRole` | `AssignmentRole` | No | `SENIOR` \| `JUNIOR` |
| `effectiveFrom` | `DateTime @db.Date` | No | |
| `effectiveTo` | `DateTime @db.Date` | Yes | `NULL` = current assignment |
| `reason` | `String` | Yes | Free text for the reassignment |

Constraints:
- Partial unique on `(lineId)` where `assignmentRole = 'SENIOR' AND effectiveTo IS NULL` — one current Senior per line
- Partial unique on `(staffProfileId)` where `effectiveTo IS NULL` — a staff member works one line at a time
- Check `effectiveTo IS NULL OR effectiveTo >= effectiveFrom`

---

## Customers and accounts

### `customer`

| Column | Type | Null | Notes |
| --- | --- | --- | --- |
| `customerCode` | `String` | No | Unique (`CUS-00417`) |
| `name` | `String` | No | |
| `mobile` | `String` | No | E.164. Indexed, **not** unique — family members share numbers |
| `alternateMobile` | `String` | Yes | |
| `address` | `String` | No | |
| `sectorId` | `String` | No | FK → `sector.id`. Denormalised from line for query convenience |
| `lineId` | `String` | No | FK → `line.id`. **Current** line; historical attribution lives on `collection` (BR-15) |
| `status` | `CustomerStatus` | No | `ACTIVE` \| `INACTIVE` \| `BLACKLISTED` |
| `notes` | `String` | Yes | |
| `deletedAt` | `DateTime` | Yes | Soft delete. Blocked while any `ACTIVE` account exists |

### `customer_reference`

| Column | Type | Null | Notes |
| --- | --- | --- | --- |
| `customerId` | `String` | No | FK → `customer.id`, cascade delete |
| `name` | `String` | No | |
| `mobile` | `String` | No | |
| `relation` | `String` | Yes | Free text — "brother", "shop owner opposite" |
| `address` | `String` | Yes | |

Multiple references per customer are allowed; at least one is required at onboarding.

### `account_loan`

The loan. Called "Account" everywhere in the UI.

| Column | Type | Null | Notes |
| --- | --- | --- | --- |
| `accountCode` | `String` | No | Unique (`ACC-2026-00892`) |
| `customerId` | `String` | No | FK → `customer.id` |
| `lineId` | `String` | No | FK → `line.id`. Line at creation |
| `accountAmount` | `Decimal` | No | `A`. Immutable after disbursement |
| `investedAmount` | `Decimal` | No | `I`. Immutable after disbursement |
| `profitAmount` | `Decimal` | No | `P`. Derived (BR-01); check constraint enforces `= A - I` |
| `dailyAmount` | `Decimal` | No | `D` |
| `termDays` | `Int` | No | `N`. Default `100` |
| `disbursementDate` | `DateTime @db.Date` | No | Day 0, not a collection day (BR-03) |
| `firstCollectionDate` | `DateTime @db.Date` | No | Next working day after disbursement |
| `targetCompletionDate` | `DateTime @db.Date` | No | Recomputed after every collection (BR-06) |
| `actualCompletionDate` | `DateTime @db.Date` | Yes | Set when status → `COMPLETED` |
| `collectedAmount` | `Decimal` | No | Denormalised cache, default `0`. Reconciled nightly |
| `outstandingAmount` | `Decimal` | No | Cache of `A − collected` |
| `status` | `AccountStatus` | No | `PENDING` \| `ACTIVE` \| `COMPLETED` \| `DEFAULTED` \| `WRITTEN_OFF` |
| `isOverdue` | `Boolean` | No | Flag on `ACTIVE`, not a status (BR-05). Set by scheduled job |
| `closureNote` | `String` | Yes | Required for `DEFAULTED` / `WRITTEN_OFF` |

Check constraints: `investedAmount < accountAmount`, `dailyAmount <= accountAmount`, `dailyAmount * termDays >= accountAmount`, `collectedAmount >= 0`.

**No constraint limits concurrent `ACTIVE` accounts per customer** (BR-01a). This is intentional, and noted here because its absence is a decision rather than an oversight.

### `account_schedule`

The plan. Regenerable tail, immutable head (BR-04, BR-06).

| Column | Type | Null | Notes |
| --- | --- | --- | --- |
| `accountLoanId` | `String` | No | FK → `account_loan.id`, cascade delete |
| `sequence` | `Int` | No | 1-based. Unique with `accountLoanId` |
| `dueDate` | `DateTime @db.Date` | No | Always a working day (BR-02) |
| `expectedAmount` | `Decimal` | No | `min(D, outstanding at generation)` (BR-07) |
| `status` | `ScheduleStatus` | No | `PENDING` \| `COLLECTED` \| `PARTIAL` \| `MISSED` \| `CANCELLED` |

`CANCELLED` covers slots dropped when an account completes early. `MISSED` is set by the scheduled job after day close (BR-09) — note this is a *schedule* status, since a missed visit creates no collection row.

---

## Collections and cash

### `collection`

**Append-only.** No update path exists in the API (BR-14).

| Column | Type | Null | Notes |
| --- | --- | --- | --- |
| `idempotencyKey` | `String` | No | **Unique.** Client-generated UUID v4 at record time (BR-13) |
| `accountLoanId` | `String` | No | FK → `account_loan.id`. **Mandatory, never inferred** — a customer may hold several active accounts (BR-01a) |
| `accountScheduleId` | `String` | Yes | FK → `account_schedule.id`. Null for adjustments |
| `lineId` | `String` | No | **Frozen at write** (BR-15) |
| `collectedByUserId` | `String` | No | **Frozen at write.** Who physically collected |
| `businessDate` | `DateTime @db.Date` | No | `Asia/Kolkata` (BR-12) |
| `capturedAt` | `DateTime` | No | Device clock at recording — may precede `syncedAt` by hours |
| `syncedAt` | `DateTime` | No | Server receipt. Equals `capturedAt` when online |
| `expectedAmount` | `Decimal` | No | Snapshot; not recomputable later |
| `amount` | `Decimal` | No | Actually collected. `0` is valid (`NO_PAYMENT`); negative only on `ADJUSTMENT` |
| `variance` | `Decimal` | No | `amount − expectedAmount` |
| `classification` | `Classification` | No | `CORRECT` \| `LOW` \| `EXTRA` \| `NO_PAYMENT` (BR-08) |
| `entryType` | `EntryType` | No | `ORIGINAL` \| `ADJUSTMENT` |
| `adjustsCollectionId` | `String` | Yes | Self-FK. Required when `entryType = ADJUSTMENT` |
| `status` | `CollectionStatus` | No | `PENDING_APPROVAL` \| `CONFIRMED` \| `REVERSED` |
| `note` | `String` | Yes | |

No `updatedAt` — nothing updates. `status` transitions are the sole exception and are themselves audited.

### `collection_approval`

| Column | Type | Null | Notes |
| --- | --- | --- | --- |
| `collectionId` | `String` | No | Unique. FK → `collection.id` |
| `requestedByUserId` | `String` | No | |
| `decidedByUserId` | `String` | Yes | Senior (own line) or Admin |
| `decision` | `ApprovalDecision` | No | `PENDING` \| `APPROVED` \| `REJECTED` |
| `reason` | `String` | No | Required from the requester |
| `decisionNote` | `String` | Yes | |
| `decidedAt` | `DateTime` | Yes | |

### `day_close`

| Column | Type | Null | Notes |
| --- | --- | --- | --- |
| `lineId` | `String` | No | FK → `line.id`. Unique with `businessDate` |
| `businessDate` | `DateTime @db.Date` | No | |
| `expectedTotal` | `Decimal` | No | Σ expected for slots due that date (BR-16) |
| `collectedTotal` | `Decimal` | No | Σ confirmed collections |
| `cashReceivedTotal` | `Decimal` | No | Σ acknowledged handovers |
| `discrepancy` | `Decimal` | No | `cashReceivedTotal − collectedTotal` |
| `status` | `DayCloseStatus` | No | `OPEN` \| `CLOSED` \| `REOPENED` \| `TALLIED` |
| `closedByUserId` | `String` | Yes | |
| `closedAt` | `DateTime` | Yes | |
| `reopenReason` | `String` | Yes | Required for a *manual* reopen. Null when reopened automatically by a late offline sync (BR-16a), which is audited with the system as actor |

`TALLIED` is `CLOSED` with `discrepancy = 0` and every handover acknowledged.

### `cash_handover`

| Column | Type | Null | Notes |
| --- | --- | --- | --- |
| `dayCloseId` | `String` | No | FK → `day_close.id` |
| `fromUserId` | `String` | No | Junior, or Senior on the second hop |
| `toUserId` | `String` | No | Senior, or Admin |
| `declaredAmount` | `Decimal` | No | Physically counted |
| `systemAmount` | `Decimal` | No | What Rasi recorded for that person and date |
| `discrepancy` | `Decimal` | No | `declaredAmount − systemAmount` |
| `status` | `HandoverStatus` | No | `PENDING` \| `ACKNOWLEDGED` \| `DISPUTED` |
| `acknowledgedAt` | `DateTime` | Yes | Cash has not moved until this is set (BR-17) |
| `disputeNote` | `String` | Yes | |

### `cash_denomination`

| Column | Type | Null | Notes |
| --- | --- | --- | --- |
| `cashHandoverId` | `String` | No | FK → `cash_handover.id`, cascade delete |
| `denomination` | `Int` | No | `500` \| `200` \| `100` \| `50` \| `20` \| `10` \| `5` \| `2` \| `1` |
| `count` | `Int` | No | `>= 0` |
| `subtotal` | `Decimal` | No | `denomination × count` |

Unique on `(cashHandoverId, denomination)`. Σ `subtotal` must equal `declaredAmount`.

---

## Ledger

All three tables are append-only with no `updatedAt`.

### `ledger_account`

| Column | Type | Null | Notes |
| --- | --- | --- | --- |
| `accountType` | `LedgerAccountType` | No | `CASH_IN_HAND` \| `CASH_AT_OFFICE` \| `LOAN_RECEIVABLE` \| `CAPITAL` \| `UNEARNED_PROFIT` \| `EARNED_PROFIT` |
| `ownerUserId` | `String` | Yes | Required for `CASH_IN_HAND` |
| `accountLoanId` | `String` | Yes | Required for `LOAN_RECEIVABLE` |
| `normalBalance` | `Direction` | No | `DEBIT` \| `CREDIT` |
| `balance` | `Decimal` | No | Cache; rebuilt and verified nightly |

One `CASH_IN_HAND` per staff member, one `LOAN_RECEIVABLE` per account, created automatically.

### `ledger_transaction`

| Column | Type | Null | Notes |
| --- | --- | --- | --- |
| `transactionType` | `LedgerTransactionType` | No | `DISBURSEMENT` \| `COLLECTION` \| `HANDOVER` \| `ADJUSTMENT` \| `WRITE_OFF` |
| `sourceTable` | `String` | No | Polymorphic reference, no FK (see ERD §4) |
| `sourceId` | `String` | No | |
| `businessDate` | `DateTime @db.Date` | No | |
| `eventAt` | `DateTime` | No | When the event occurred, not when recorded |
| `description` | `String` | No | |

### `ledger_entry`

| Column | Type | Null | Notes |
| --- | --- | --- | --- |
| `ledgerTransactionId` | `String` | No | FK → `ledger_transaction.id` |
| `ledgerAccountId` | `String` | No | FK → `ledger_account.id` |
| `direction` | `Direction` | No | `DEBIT` \| `CREDIT` |
| `amount` | `Decimal` | No | **Always positive.** Direction carries the sign |
| `sequence` | `Int` | No | Ordering within the transaction |

A deferred constraint trigger enforces Σ debits = Σ credits per transaction at commit (BR-18).

---

## Notifications and platform

### `notification`

| Column | Type | Null | Notes |
| --- | --- | --- | --- |
| `userId` | `String` | No | Recipient |
| `category` | `NotificationCategory` | No | `INFORMATION` \| `SUCCESS` \| `WARNING` \| `ALERT` (PDF §24) |
| `eventType` | `NotificationEvent` | No | `NEW_ASSIGNMENT` \| `LOW_COLLECTION` \| `EXTRA_COLLECTION` \| `MISSED_COLLECTION` \| `ACCOUNT_COMPLETED` \| `DAY_CLOSE_DISCREPANCY` \| `APPROVAL_REQUESTED` |
| `title` | `String` | No | |
| `body` | `String` | No | |
| `payload` | `Json` | Yes | Deep-link context — entity type and id |
| `readAt` | `DateTime` | Yes | |

### `push_subscription`

| Column | Type | Null | Notes |
| --- | --- | --- | --- |
| `userId` | `String` | No | |
| `provider` | `PushProvider` | No | `WEB_PUSH` \| `FCM` |
| `endpoint` | `String` | Yes | Web Push. Unique when set |
| `p256dh` | `String` | Yes | Web Push |
| `auth` | `String` | Yes | Web Push |
| `fcmToken` | `String` | Yes | FCM. Unique when set |
| `deviceLabel` | `String` | Yes | "Suresh — Redmi Note 12" |
| `lastSeenAt` | `DateTime` | No | |
| `isActive` | `Boolean` | No | Set `false` on a `410 Gone` from the push service |

Check constraint: `WEB_PUSH` requires `endpoint`/`p256dh`/`auth`; `FCM` requires `fcmToken`.

### `notification_outbox`

| Column | Type | Null | Notes |
| --- | --- | --- | --- |
| `notificationId` | `String` | No | FK → `notification.id` |
| `pushSubscriptionId` | `String` | No | FK → `push_subscription.id` |
| `status` | `OutboxStatus` | No | `PENDING` \| `SENT` \| `FAILED` \| `EXPIRED` |
| `attempts` | `Int` | No | Default `0` |
| `lastError` | `String` | Yes | |
| `nextAttemptAt` | `DateTime` | Yes | Exponential backoff |
| `sentAt` | `DateTime` | Yes | |

### `holiday`

| Column | Type | Null | Notes |
| --- | --- | --- | --- |
| `date` | `DateTime @db.Date` | No | |
| `name` | `String` | No | |
| `sectorId` | `String` | Yes | `NULL` = business-wide (BR-02) |

Unique on `(date, sectorId)`. Sundays are **not** stored here — they are excluded by rule, not by data.

### `audit_log`

Append-only, no `updatedAt`.

| Column | Type | Null | Notes |
| --- | --- | --- | --- |
| `actorUserId` | `String` | Yes | Null for system actions |
| `entityTable` | `String` | No | |
| `entityId` | `String` | No | |
| `action` | `AuditAction` | No | `CREATE` \| `UPDATE` \| `DELETE` \| `APPROVE` \| `REJECT` \| `LOGIN` \| `REOPEN_DAY` |
| `before` | `Json` | Yes | |
| `after` | `Json` | Yes | |
| `ipAddress` | `String` | Yes | |
| `userAgent` | `String` | Yes | |

### `idempotency_key`

| Column | Type | Null | Notes |
| --- | --- | --- | --- |
| `key` | `String @id` | No | Client UUID v4 |
| `userId` | `String` | No | |
| `endpoint` | `String` | No | Scopes the key to one operation |
| `responseBody` | `Json` | No | Original response, replayed verbatim (BR-13) |
| `responseStatus` | `Int` | No | |
| `expiresAt` | `DateTime` | No | 90 days; purged by scheduled job |

### `setting`

| Column | Type | Null | Notes |
| --- | --- | --- | --- |
| `key` | `String` | No | Unique (`collection.varianceTolerance`) |
| `value` | `Json` | No | |
| `description` | `String` | No | |

Runtime business settings only. Infrastructure configuration stays in environment variables.

### `organization`

Single row in v1. Present so multi-tenancy is a migration rather than a rewrite.

| Column | Type | Null | Notes |
| --- | --- | --- | --- |
| `name` | `String` | No | |
| `timezone` | `String` | No | `Asia/Kolkata` |
| `currency` | `String` | No | `INR` |
