# Personas

Four roles, four very different working conditions. The design constraints below are not colour — they directly determine screen design, offline behaviour and permission scope.

---

## Junior — the collector

**Job:** visit assigned customers daily, collect cash, record each collection.

**Working conditions.** On foot or on a two-wheeler, for most of the day. Using a personal mid-range Android phone, one-handed, often standing at a customer's door, sometimes in bright sunlight. Signal is unreliable and in some areas absent. The phone's battery is shared with the rest of their day.

**What they need from Rasi:** today's route, in visiting order. For each customer: name, address, what to collect, and a field for what was actually collected. Confirmation that the entry is saved. Nothing else.

One wrinkle that shapes the whole screen: a customer may hold **more than one active account** (BR-01a), so one door can mean two amounts. The single-account case must stay a one-tap confirm; the multi-account case must look visibly different, or a Junior in a hurry will put the whole sum against the first account.

**Design constraints this imposes:**
- Recording a collection **must succeed offline**, instantly and locally. This is the single hardest requirement in the system and it is non-negotiable.
- Large touch targets, high contrast, numeric keypad for amounts. Assume gloves, assume glare.
- Every saved collection needs an unmistakable visual confirmation, and an honest sync state — *saved on device* is different from *synced to office* and the Junior must be able to tell which.
- Minimum possible data entry. The expected amount is pre-filled; the common case is one tap to confirm.
- Never block on a network call. Never show a spinner the Junior has to wait out.

**Permissions:** their assigned customers only. Records collections. Cannot see other lines, other Juniors, profit figures, or any business-level total.

**Failure mode to design against:** a Junior loses signal mid-route, records twelve collections, and the phone is closed before reconnecting. Every one of those twelve must survive and sync later, exactly once.

---

## Senior — the supervisor

**Job:** supervise one line. Monitor the Juniors on it, verify collections, receive their cash, respond to alerts.

**Working conditions.** Partly in the field, partly at a desk. Phone during the day, sometimes a laptop in the evening. Connectivity is usually available but not guaranteed.

**What they need from Rasi:** the state of their line today — expected versus collected, who has tallied and who hasn't, which customers underpaid, which were missed. The alerts from the source document (§12) land here: new assignment, low collection, extra collection, account completion.

**Design constraints:**
- Alert-driven. The Senior should not have to go looking for problems; problems should arrive.
- Their entire world is one line. Showing sector or business figures is noise, and the permission model enforces that rather than merely hiding it in the UI.
- Cash receipt from Juniors is an action they perform with money physically in hand — the handover confirmation screen needs a denomination count and must be quick.

**Permissions:** read across their own line. Verifies collections and approves corrections. Receives cash. Limited investment/profit visibility for their line only. No management actions — cannot create customers, accounts or assignments.

---

## Admin — the operator

**Job:** run daily operations. Onboard customers, create accounts, manage sectors and lines, assign staff, chase problems.

**Working conditions.** Desk-based, laptop or desktop, reliable connectivity, working in Rasi for extended sessions. The heaviest user of the system by hours.

**What they need from Rasi:** efficient data entry for onboarding, a clear operational picture across all lines, and the tools to act — reassign a Junior, approve a correction, investigate a discrepancy.

**Design constraints:**
- Keyboard-efficient. Dense tables, filters, sorting, bulk actions. This is the one persona for whom information density is a feature.
- Account creation is the highest-frequency complex form in the system; derived values (profit, target completion date, schedule preview) must update live so mistakes are caught before saving, not after.
- Junior reassignment happens often and has consequences for reporting — the UI must make the effective date explicit rather than implying "now".

**Permissions:** full operational management and reporting across all sectors and lines. Cannot alter system settings or user roles — those are the Super Admin's.

---

## Super Admin — the owner

**Job:** know the state of the business.

**Working conditions.** Short, frequent sessions. Phone in the morning, laptop when something needs attention. Low patience for navigation.

**What they need from Rasi:** the answer to "how did we do today" without a single click — total expected, total collected, shortfall, surplus, cash position, and which sectors have tallied. Then the ability to drill down: business → sector → line → customer, along the rollup chain.

**Design constraints:**
- The overview screen must answer the primary question **above the fold, on a phone**. Everything else is secondary.
- Every figure must be drillable to its underlying records. A total that cannot be explained is a total that will not be trusted, and trust in the numbers is the entire point of replacing the spreadsheet.
- Comparison across sectors and lines matters more than absolute figures.

**Permissions:** everything, including settings and role management.

---

## Not a persona: the Customer

The customer is central to the business and **absent from the software**. No login, no credentials, no access. They interact with Rasi only indirectly — through the Junior at their door, and through the collection note in their hand.

This is a deliberate v1 boundary, and it has one consequence worth stating: the paper collection note remains the customer's only record of what they have paid. Anything Rasi records that the customer cannot see must be reconcilable against that note if it is ever disputed. Digital receipts (deferred to Phase 2) are the eventual answer.

---

## Constraint summary

| | Junior | Senior | Admin | Super Admin |
| --- | --- | --- | --- | --- |
| Primary device | Android phone | Phone + laptop | Desktop | Phone + laptop |
| Connectivity | **Unreliable — offline required** | Usually online | Reliable | Reliable |
| Session length | All day, seconds at a time | Short, frequent | Hours | Minutes |
| Data scope | Assigned customers | One line | All lines | Everything |
| Writes data? | Yes — collections | Verifies, receives cash | Yes — everything operational | Settings |
| Sees profit? | No | Own line only | Yes | Yes |
| UI priority | Speed + offline safety | Alerts | Density + efficiency | Answer at a glance |
