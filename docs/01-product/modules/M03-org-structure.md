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

`line_assignment` records `(lineId, staffProfileId, assignmentRole, effectiveFrom, effectiveTo)`. `effectiveTo IS NULL` means current.

> A `currentLineId` column on the staff record would be simpler and wrong. Juniors move between lines often (§16), and the question asked when a discrepancy surfaces months later is *"who was responsible for Line 3 on 14 March"*. A mutable field cannot answer it. History is the requirement, not an enhancement.

**Constraints:**
- Partial unique on `(lineId)` where `assignmentRole = 'SENIOR' AND effectiveTo IS NULL` — one current Senior per line
- Partial unique on `(staffProfileId)` where `effectiveTo IS NULL` — one line at a time per person
- `effectiveTo IS NULL OR effectiveTo >= effectiveFrom`

---

## Key rules

| Rule | Detail |
| --- | --- |
| Reassignment closes, never deletes | The outgoing assignment gets `effectiveTo`; the record stays |
| Effective dates are explicit | The UI never implies "now". An Admin picks the date |
| A line always has a Senior | Assigning a new Senior closes the incumbent's record in the same transaction |
| Juniors move freely | No limit on frequency (§16) |
| Sector deactivation | Blocked while active lines exist |
| Line deactivation | Blocked while `ACTIVE` accounts exist |

### Reassignment does not move history

Collections keep the `lineId` and `collectedByUserId` frozen at write time (BR-15). Moving a Junior changes who collects tomorrow; it changes nothing about yesterday.

> This is the acceptance test in US-013. If a line's historical totals shift when someone is reassigned, the implementation is wrong — two Seniors' track records have just been rewritten.

### Mid-day reassignment

Cash for the day follows `collection.collectedByUserId`, not current staffing (open question 5). A Junior moved at noon still hands over the morning's cash on their old line.

---

## Operations

| Operation | Actor |
| --- | --- |
| Create / update / deactivate sector | Admin+ |
| Create / update / deactivate line | Admin+ |
| Assign Senior to line | Admin+ |
| Assign / move Junior | Admin+ |
| View current staffing | Admin+, Senior (own line) |
| View assignment history | Admin+, Senior (own line) |

---

## Events

**Emitted**

| Event | Consumed by |
| --- | --- |
| `assignment.changed` | M02 (context invalidation), M10 (notify both staff and both Seniors) |
| `line.created` / `line.deactivated` | M11 |
| `sector.created` | M11 |

**Consumed:** `staff.created` (M01) — eligibility for assignment.

---

## Line overview data (§14, §20)

The line detail view aggregates from other modules — this module owns the structure, not the figures:

| Figure | Source |
| --- | --- |
| Sector, Senior, Juniors | M03 |
| Customer count, account count | M04, M05 |
| Account value, invested, profit | M09 |
| Expected / actual daily collection | M07 |
| Pending, extra, completed | M07, M05 |

---

## Risks

| Risk | Mitigation |
| --- | --- |
| Overlapping assignments corrupt scoping | Partial unique indexes enforce at the database, not in code |
| A line left without a Senior | Assignment is a transaction: close incumbent and open successor together |
| Backdated assignment rewrites scoping retroactively | `effectiveFrom` cannot precede the staff member's `joinedAt`; backdating past a closed day requires Admin and is audited |
