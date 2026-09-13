# M03 — Organisation Structure

**Purpose:** sectors, lines, and the historical record of who staffed which line and when.

**Source:** PDF §6, §14, §15, §16, §20.

---

## Scope

**In:** sector and line CRUD, Senior and Junior assignment, assignment history, current-staffing lookup.

**Out:** line financial totals (M11, M12), customer-to-line membership (M04).

---

## Owned entities

`sector` · `line` · `line_assignment`

---

## Assignment is temporal, not a field

`line_assignment` records `(lineId, staffProfileId, assignmentRole, effectiveFrom, effectiveTo)`. `effectiveTo IS NULL` means open-ended; the **current** assignment is the one in effect on a date — `effectiveFrom ≤ date ≤ effectiveTo` (corrected 2026-09-13, see As built).

> A `currentLineId` column on the staff record would be simpler and wrong. Juniors move between lines often (§16), and the question asked when a discrepancy surfaces months later is _"who was responsible for Line 3 on 14 March"_. A mutable field cannot answer it. History is the requirement, not an enhancement.

**Constraints:**

- Partial unique on `(lineId)` where `assignmentRole = 'SENIOR' AND effectiveTo IS NULL` — one current Senior per line
- Partial unique on `(staffProfileId)` where `effectiveTo IS NULL` — one line at a time per person
- `effectiveTo IS NULL OR effectiveTo >= effectiveFrom`

---

## Key rules

| Rule                               | Detail                                                                       |
| ---------------------------------- | ---------------------------------------------------------------------------- |
| Reassignment closes, never deletes | The outgoing assignment gets `effectiveTo`; the record stays                 |
| Effective dates are explicit       | The UI never implies "now". An Admin picks the date                          |
| A line always has a Senior         | Assigning a new Senior closes the incumbent's record in the same transaction |
| Juniors move freely                | No limit on frequency (§16)                                                  |
| Sector deactivation                | Blocked while active lines exist                                             |
| Line deactivation                  | Blocked while `ACTIVE` accounts exist                                        |

### Reassignment does not move history

Collections keep the `lineId` and `collectedByUserId` frozen at write time (BR-15). Moving a Junior changes who collects tomorrow; it changes nothing about yesterday.

> This is the acceptance test in US-013. If a line's historical totals shift when someone is reassigned, the implementation is wrong — two Seniors' track records have just been rewritten.

### Mid-day reassignment

Cash for the day follows `collection.collectedByUserId`, not current staffing (open question 5). A Junior moved at noon still hands over the morning's cash on their old line.

---

## Operations

| Operation                           | Actor                     |
| ----------------------------------- | ------------------------- |
| Create / update / deactivate sector | Admin+                    |
| Create / update / deactivate line   | Admin+                    |
| Assign Senior to line               | Admin+                    |
| Assign / move Junior                | Admin+                    |
| View current staffing               | Admin+, Senior (own line) |
| View assignment history             | Admin+, Senior (own line) |

---

## Events

**Emitted**

| Event                               | Consumed by                                                          |
| ----------------------------------- | -------------------------------------------------------------------- |
| `assignment.changed`                | M02 (context invalidation), M10 (notify both staff and both Seniors) |
| `line.created` / `line.deactivated` | M11                                                                  |
| `sector.created`                    | M11                                                                  |

**Consumed:** `staff.created` (M01) — eligibility for assignment.

---

## Line overview data (§14, §20)

The line detail view aggregates from other modules — this module owns the structure, not the figures:

| Figure                             | Source   |
| ---------------------------------- | -------- |
| Sector, Senior, Juniors            | M03      |
| Customer count, account count      | M04, M05 |
| Account value, invested, profit    | M09      |
| Expected / actual daily collection | M07      |
| Pending, extra, completed          | M07, M05 |

---

## As built

In `apps/api/src/organisation/`, served through the contract in `packages/contracts/src/organisation.contract.ts` ([ADR-0011](../../02-architecture/adr/0011-in-house-api-contract.md)). Status is in the [backlog](../../06-delivery/backlog.md).

| Endpoint                                    | Permission                | Refusals                                                                       |
| ------------------------------------------- | ------------------------- | ------------------------------------------------------------------------------ |
| `GET /api/sectors`                          | `organisation.view`       | — (scoped: Admins their organization, Seniors and Juniors their line's sector) |
| `GET /api/sectors/:sectorId`                | `organisation.view`       | `404` (out of scope identical to missing; inactive sectors are returned)       |
| `POST /api/sectors`                         | `sector.manage`           | `409 SECTOR_CODE_TAKEN`                                                        |
| `PATCH /api/sectors/:sectorId`              | `sector.manage`           | `404` (rename only)                                                            |
| `POST /api/sectors/:sectorId/deactivation`  | `sector.manage`           | `422 SECTOR_HAS_ACTIVE_LINES`                                                  |
| `GET /api/lines`                            | `organisation.view`       | — (scoped; `?sectorId=`, `?includeInactive=true`)                              |
| `GET /api/lines/:lineId`                    | `organisation.view`       | `404` (scoped by line: a Senior or Junior reads only their own)                |
| `POST /api/lines`                           | `line.manage`             | `404` sector, `422 SECTOR_INACTIVE`, `409 LINE_CODE_TAKEN`                     |
| `PATCH /api/lines/:lineId`                  | `line.manage`             | `404` (rename only)                                                            |
| `POST /api/lines/:lineId/deactivation`      | `line.manage`             | `422 LINE_HAS_ACTIVE_ACCOUNTS`                                                 |
| `POST /api/lines/:lineId/senior-assignment` | `assignment.assignSenior` | see below                                                                      |
| `POST /api/lines/:lineId/junior-assignment` | `assignment.moveJunior`   | see below                                                                      |

Lists are cursor-paginated. Every write records a `CREATE` or `UPDATE` audit entry in the same transaction (M13). Deactivating something already inactive changes and audits nothing. Codes are entered by the Admin and immutable; only names change.

**Assignments.** `effectiveFrom` is required. The outgoing rows — the staff member's own open assignment, and for a Senior assignment the line's open Senior — are closed with `effectiveTo = effectiveFrom − 1 day` and the new row opened, in one transaction, with nothing deleted. So "effective today" closes the incumbent yesterday (US-012), and "effective tomorrow" closes the old line today (US-013). Collections are never touched; a test moves a Junior with 400 collections and proves Line 3's count and total unchanged.

| Refusal                             | Status | When                                                                            |
| ----------------------------------- | ------ | ------------------------------------------------------------------------------- |
| `LINE_NOT_FOUND`, `STAFF_NOT_FOUND` | `404`  | Outside the caller's organization, or missing                                   |
| `LINE_INACTIVE`                     | `422`  |                                                                                 |
| `STAFF_NOT_ACTIVE`                  | `422`  | Suspended or inactive staff                                                     |
| `STAFF_ROLE_MISMATCH`               | `422`  | A Junior into the Senior assignment, or the reverse                             |
| `EFFECTIVE_BEFORE_JOINING`          | `422`  | `effectiveFrom` before `joinedAt` (the risk below)                              |
| `EFFECTIVE_NOT_AFTER_CURRENT`       | `422`  | A row being closed starts on or after `effectiveFrom`; checked before any write |
| `ALREADY_ASSIGNED`                  | `409`  | Already on this line                                                            |
| `ASSIGNMENT_CONFLICT`               | `409`  | A concurrent change tripped a partial unique index                              |

**A Senior who already runs another line may be moved — decided 2026-09-13.** Their old line is left without a Senior and returned in `linesWithoutSenior`, and recorded on the audit entry. The alternative, refusing, would make swapping two Seniors impossible without a gap. This relaxes "a line always has a Senior" to "assigning a Senior never leaves the _target_ line without one".

**"Current" is date-aware** (M02): a row opened "effective tomorrow" does not change anyone's scope until tomorrow.

**Staffing views:** `GET /api/staffing` (US-014, `staff.list`) and `GET /api/lines/:lineId/assignments?on=` (US-015, `assignment.viewHistory`), both scoped by line.

**Screens:**
- `/sectors` and `/sectors/:id` (S-13) are for Admin and Super Admin only.
- `/lines` and `/lines/:id` (S-12) are also open to a Senior, who sees their own line read-only. The line detail shows today's staffing and the assignment history.
- The §14 figures are stated as unavailable until M05, M07 and M09 exist; the page never shows zeros in their place.
- `/team` and `/team/:id` (S-14) show each person's line today and their history.
- The S-15 assign dialog opens from a line or from a person. It has no default effective date; "Use today" is an explicit button. After saving, it says which assignments were closed and names any line left without a Senior.

**Not built:** notifications to the staff and Seniors involved (M10), `assignment.changed` and the other events (no event bus yet), reactivation, and the backdating-past-a-closed-day rule (day close is M08). Deactivating a line does not close its open assignments.

---

## Risks

| Risk                                                | Mitigation                                                                                                               |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Overlapping assignments corrupt scoping             | Partial unique indexes enforce at the database, not in code                                                              |
| A line left without a Senior                        | Assignment is a transaction: close incumbent and open successor together                                                 |
| Backdated assignment rewrites scoping retroactively | `effectiveFrom` cannot precede the staff member's `joinedAt`; backdating past a closed day requires Admin and is audited |
