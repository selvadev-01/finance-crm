# RBAC Matrix

Expands PDF Appendix A from feature-level to action-level. Appendix A says a Senior can "Verify" collection entries; this document says exactly which API operations that means and over which rows.

**The central rule:** permission has two independent parts — **can this role perform this action**, and **on which rows**. Both are enforced server-side. A Junior who crafts a request for another line's customer is refused by the API, not merely prevented by a hidden button.

---

## Roles

| Role          | Scope                                              | Nature                                                    |
| ------------- | -------------------------------------------------- | --------------------------------------------------------- |
| `SUPER_ADMIN` | Everything                                         | Owner. Only role that may change settings and staff roles |
| `ADMIN`       | All sectors and lines                              | Operational management. Cannot change settings or roles   |
| `SENIOR`      | **One line** — their current assignment            | Supervision, verification, cash receipt                   |
| `JUNIOR`      | **Their assigned customers** on their current line | Collection entry only                                     |

Roles are single-valued: a person is a Senior or a Junior, never both.

---

## Data scoping

Scoping is applied before any action check, as a mandatory predicate on every query. "none" for Admins means no line restriction — they are still bounded by their own `organizationId`.

| Role          | Predicate                                                                |
| ------------- | ------------------------------------------------------------------------ |
| `SUPER_ADMIN` | none                                                                     |
| `ADMIN`       | none                                                                     |
| `SENIOR`      | `lineId = (current assignment of this staff member)`                     |
| `JUNIOR`      | `lineId = (current assignment)` **and** customer assigned to this Junior |

**"Current assignment" means the `line_assignment` in effect today** — `effectiveFrom ≤ today ≤ effectiveTo`, with a null `effectiveTo` open-ended, and today the business date in Asia/Kolkata. (Corrected 2026-09-13 from "`effectiveTo IS NULL`", which switched a Junior moved "effective tomorrow" to the new line a day early.) Not a field on the staff record — the assignment table is the authority (M03).

> **Open question — "customer assigned to this Junior".** The data model has no customer-to-Junior assignment, and a line may have several current Juniors. **Decided 2026-09-13, for now:** a Junior's customers are every customer on their current line. That is exact while a line has one Junior at a time; if lines share Juniors, add a temporal `customer_assignment` table (which is also where route visiting order belongs) and change the single predicate that encodes this ([M02 as built](modules/M02-access-control.md#as-built)).

> **Scoping applies to historical rows by the row's own attribution, not the viewer's current line.** A Senior moved from Line 3 to Line 7 sees Line 7's data — including collections recorded on Line 7 before they arrived, and _not_ including the Line 3 history they used to supervise. The line is the unit of responsibility; the person is not.
>
> This has a consequence worth accepting consciously: a Senior cannot review their own past work after a transfer. Admins can, and that is the correct place for that capability.

---

## Action matrix

`✓` full · `own` scoped to their line/customers · `—` denied

### Customers (M04)

| Action          | Super Admin | Admin |  Senior  |    Junior    |
| --------------- | :---------: | :---: | :------: | :----------: |
| List / view     |      ✓      |   ✓   | own line | own assigned |
| Create          |      ✓      |   ✓   |    —     |      —       |
| Update          |      ✓      |   ✓   |    —     |      —       |
| Change line     |      ✓      |   ✓   |    —     |      —       |
| Soft delete     |      ✓      |   —   |    —     |      —       |
| View references |      ✓      |   ✓   | own line | own assigned |

### Accounts (M05)

| Action                           | Super Admin | Admin |  Senior  |    Junior    |
| -------------------------------- | :---------: | :---: | :------: | :----------: |
| List / view                      |      ✓      |   ✓   | own line | own assigned |
| Create                           |      ✓      |   ✓   |    —     |      —       |
| Disburse                         |      ✓      |   ✓   |    —     |      —       |
| Update terms (pre-disbursement)  |      ✓      |   ✓   |    —     |      —       |
| Mark `DEFAULTED` / `WRITTEN_OFF` |      ✓      |   —   |    —     |      —       |
| View schedule                    |      ✓      |   ✓   | own line | own assigned |

> Amounts are immutable after disbursement (BR-01) — no role may change them. Writing off is Super Admin only: it destroys receivable value and must not be a routine operational action.

### Collections (M07)

| Action               | Super Admin | Admin |  Senior  |      Junior      |
| -------------------- | :---------: | :---: | :------: | :--------------: |
| Record collection    |      —      |   —   |    —     | **own assigned** |
| View                 |      ✓      |   ✓   | own line |   own entries    |
| Request correction   |      —      |   —   | own line |   own entries    |
| Approve correction   |      ✓      |   ✓   | own line |        —         |
| Reverse a collection |      ✓      |   ✓   |    —     |        —         |

> **Only Juniors record collections.** This is deliberate and stricter than Appendix A, which shows "View" for Admin and Super Admin. Recording is a statement that cash physically changed hands, and only the person at the door can make it. An Admin correcting an error does so through the approval path, which leaves both records visible — not by recording a collection they did not take.
>
> A Senior approves corrections on their own line but cannot request and approve the same one; self-approval is blocked regardless of role.

### Day close and cash (M08)

| Action               | Super Admin | Admin |  Senior  |  Junior  |
| -------------------- | :---------: | :---: | :------: | :------: |
| View day close       |      ✓      |   ✓   | own line |    —     |
| Close day            |      ✓      |   ✓   | own line |    —     |
| Reopen day (manual)  |      ✓      |   ✓   |    —     |    —     |
| Initiate handover    |      —      |   —   | own line | own cash |
| Acknowledge handover |      ✓      |   ✓   | own line |    —     |
| Dispute handover     |      ✓      |   ✓   | own line | own cash |
| Record denominations |      —      |   —   |    ✓     |    ✓     |

> Manual reopen is Admin-and-above: it unlocks a settled day's figures. Automatic reopening by a late offline sync (BR-16a) is a system action requiring no permission.

### Organisation (M03)

| Action                  | Super Admin | Admin |  Senior  |  Junior  |
| ----------------------- | :---------: | :---: | :------: | :------: |
| View sectors / lines    |      ✓      |   ✓   | own line | own line |
| Create / update sector  |      ✓      |   ✓   |    —     |    —     |
| Create / update line    |      ✓      |   ✓   |    —     |    —     |
| Assign Senior to line   |      ✓      |   ✓   |    —     |    —     |
| Assign / move Junior    |      ✓      |   ✓   |    —     |    —     |
| View assignment history |      ✓      |   ✓   | own line |    —     |

### Money visibility (M09, M11, M12)

| Data                    | Super Admin | Admin |  Senior  |    Junior    |
| ----------------------- | :---------: | :---: | :------: | :----------: |
| Business totals         |      ✓      |   ✓   |    —     |      —       |
| Sector totals           |      ✓      |   ✓   |    —     |      —       |
| Line totals             |      ✓      |   ✓   | own line |      —       |
| Invested amount         |      ✓      |   ✓   | own line |      —       |
| **Profit**              |      ✓      |   ✓   | own line |    **—**     |
| Outstanding per account |      ✓      |   ✓   | own line | own assigned |
| Ledger entries          |      ✓      |   ✓   |    —     |      —       |
| Reports                 |      ✓      |   ✓   | own line |      —       |

> **Juniors never see profit or invested amounts** — matching Appendix A. A Junior sees what to collect and what remains, which is all their job requires. The margin on a customer's account is not their business, and exposing it in the field creates friction with customers.
>
> Appendix A's "Limited" for Senior investment/profit is interpreted as **their own line only**. The raw ledger is Admin-and-above: it is the audit substrate, and a Senior reading it could infer business-wide figures from cash and capital accounts.

### Notifications (M10)

| Action                 | Super Admin |    Admin    |  Senior  |   Junior    |
| ---------------------- | :---------: | :---------: | :------: | :---------: |
| View own notifications |      ✓      |      ✓      |    ✓     |      ✓      |
| Scope received         |     All     | Operational | Own line | Own entries |
| Register push device   |      ✓      |      ✓      |    ✓     |      ✓      |
| Manage preferences     |      ✓      |      ✓      |    ✓     |      ✓      |

### Administration (M01, M13, M15)

| Action                   | Super Admin | Admin |  Senior  | Junior |
| ------------------------ | :---------: | :---: | :------: | :----: |
| List staff               |      ✓      |   ✓   | own line |   —    |
| Create staff             |      ✓      |   ✓   |    —     |   —    |
| **Change staff role**    |      ✓      |   —   |    —     |   —    |
| Suspend staff            |      ✓      |   ✓   |    —     |   —    |
| Reset another's password |      ✓      |   ✓   |    —     |   —    |
| **View audit log**       |      ✓      |   ✓   |    —     |   —    |
| **Change settings**      |      ✓      |   —   |    —     |   —    |
| Declare holiday          |      ✓      |   ✓   |    —     |   —    |

> Role change is Super Admin only — otherwise an Admin could promote themselves. Settings likewise: they alter business rules, and changing one is not an operational act.

---

## Navigation by role

PDF §25 lists nine areas. What each role actually sees:

| Nav item      | Super Admin | Admin |  Senior   |      Junior       |
| ------------- | :---------: | :---: | :-------: | :---------------: |
| Dashboard     |      ✓      |   ✓   | Line view | **Today's route** |
| Customers     |      ✓      |   ✓   |     ✓     |   Assigned only   |
| Sectors       |      ✓      |   ✓   |     —     |         —         |
| Lines         |      ✓      |   ✓   | Own line  |         —         |
| Collections   |      ✓      |   ✓   |     ✓     |    Own entries    |
| Team          |      ✓      |   ✓   | Own line  |         —         |
| Notifications |      ✓      |   ✓   |     ✓     |         ✓         |
| Reports       |      ✓      |   ✓   |  Limited  |         —         |
| Settings      |      ✓      |   —   |     —     |         —         |

> The Junior's "Dashboard" is not a dashboard — it is today's route list. Giving a Junior an aggregate screen would be noise, and the route is the only screen they need open all day. This is a deliberate departure from §25's uniform navigation.

---

## Enforcement

Three layers, in order. The first two are required; the third is convenience only.

1. **Authentication** — Better Auth session (M01). No session, no access.
2. **Authorisation** — a policy guard resolving role + current line assignment, applied to every endpoint. Scoping predicates are injected into queries at the repository layer so an unscoped query is impossible to write by accident.
3. **UI** — menus and buttons hidden by role. **Convenience, never a control.** Every hidden action must independently fail at the API.

**Testing requirement:** every cell in the matrices above is an API-level test asserting the actual HTTP response. Hidden-button verification does not count as coverage — gate 5 in the PRD depends on this.

> **Failure semantics:** a scoped-out row returns `404`, not `403`. A Junior probing another line's customer IDs learns nothing about whether they exist. Denied _actions_ on visible rows return `403`, which is safe because the row's existence is already known.
