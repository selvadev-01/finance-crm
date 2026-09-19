# M01 — Identity

**Purpose:** establish who is using Rasi. Sign-in, sessions, credentials, and the staff record that every other module scopes against.

**Source:** PDF §5.

---

## Scope

**In:** Better Auth configuration and mounting, email/password sign-in, session lifecycle, password reset, staff profile CRUD, device registration handoff to M10.

**Out:** authorisation and scoping (M02), line assignment (M03). This module answers _who you are_, never _what you may do_.

---

## Owned entities

| Entity                                       | Owner           | Notes                                            |
| -------------------------------------------- | --------------- | ------------------------------------------------ |
| `user`, `session`, `account`, `verification` | **Better Auth** | Generated. Never hand-edited                     |
| `staff_profile`                              | Rasi            | 1:1 with `user`. Role, staff code, phone, status |

The split is deliberate: keeping Rasi data out of the generated tables means `better-auth generate` stays re-runnable across version upgrades. See [`../../02-architecture/authentication.md`](../../02-architecture/authentication.md).

---

## Key rules

- A staff member is created by an Admin, never self-registered. The one exception is the owner of a new organization, who signs up publicly as its Super Admin ([ADR-0012](../../02-architecture/adr/0012-organization-sign-up.md)).
- Role is single-valued — Senior or Junior, never both.
- `status` gates sign-in: only `ACTIVE` may authenticate. `SUSPENDED` and `INACTIVE` are refused with a message that does not reveal whether the password was correct.
- Soft delete (`deletedAt`) is blocked while the staff member holds an open line assignment or has unacknowledged cash.

### Session duration is a field-driven decision

With **Keep me signed in** ticked (the default), sessions last **7 days with rolling renewal** — every day of use pushes expiry out again. Unticked, the session ends when the browser closes, or after 1 day at most. Either way a session ends **30 days after sign-in**, however recently it was renewed. Details in [authentication.md](../../02-architecture/authentication.md#session-duration).

> A Junior signs in once and works for weeks without thinking about it. An expiring session is not an inconvenience for them — it is a hard stop, because re-authentication needs connectivity and they may have none. A session that expires overnight strands a collector with a full route and no way to record anything.
>
> The compensating control is that suspension takes effect immediately server-side: revoking access does not wait for a session to expire.

---

## Operations

| Operation                | Actor                | Notes                                                                                       |
| ------------------------ | -------------------- | ------------------------------------------------------------------------------------------- |
| Sign up an organization  | Anyone               | Creates the organization, its slug and its owner as Super Admin. Rate-limited. Audited      |
| Sign in                  | Anyone               | Better Auth. Audited                                                                        |
| Sign out                 | Self                 | **Blocked with a warning if unsynced collections exist** — local data dies with the session |
| Request password reset   | Self                 | Email                                                                                       |
| Reset another's password | Admin+               | For field staff without email                                                               |
| Create staff             | Admin+               | Creates `user` + `staff_profile` atomically                                                 |
| Update staff             | Admin+               |                                                                                             |
| Change role              | **Super Admin only** | Otherwise an Admin could promote themselves                                                 |
| Suspend / reactivate     | Admin+               | Immediate                                                                                   |

---

## Events emitted

| Event                | Consumed by                       |
| -------------------- | --------------------------------- |
| `staff.created`      | M03 (assignment eligibility), M13 |
| `staff.suspended`    | M02 (session revocation), M13     |
| `staff.role_changed` | M02, M13                          |
| `auth.signed_in`     | M13                               |

---

## As built — sign-in

In `apps/api/src/auth/` (`sign-in-policy.ts`, `sign-in-audit.ts`), as Better Auth `before` and `after` hooks on `/sign-in/email`. Status is in the [backlog](../../06-delivery/backlog.md).

| Attempt                                                                   | Response                                                                            | `LOGIN` audit `after`                              |
| ------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- | -------------------------------------------------- |
| `ACTIVE`, undeleted staff, right password                                 | `200`, session cookie                                                               | `{ outcome: SUCCESS }`                             |
| `SUSPENDED`, `INACTIVE`, soft-deleted, or no staff profile — any password | `403 STAFF_NOT_ACTIVE` — "This account cannot sign in. Contact your administrator." | `{ outcome: REFUSED, reason: STAFF_NOT_ACTIVE }`   |
| Known user, wrong password                                                | `401 INVALID_EMAIL_OR_PASSWORD`                                                     | `{ outcome: FAILURE, reason: … }` against the user |
| Unknown email                                                             | `401 INVALID_EMAIL_OR_PASSWORD`                                                     | Same, `actorUserId` null, `entityId` `unknown`     |

**The status check runs before the password is verified**, so the refusal is byte-identical whether or not the password was right. **The message is distinct from a wrong password — decided 2026-09-13**: a suspended Junior should contact their Senior rather than retry. The accepted cost is that someone who knows a staff email can learn the account is not active.

**The typed email is never recorded** for an attempt that matches no user — a mistyped address is personal data about someone else. Every row records IP address (derived as Better Auth derives `session.ipAddress`) and user agent; no row records a password.

**A sign-in that cannot be audited does not happen**: if the `SUCCESS` write fails, the new session is deleted and the request fails with `500 SIGN_IN_AUDIT_FAILED`.

**Better Auth's sign-up is disabled** (`disableSignUp`). Users with credentials are created server-side: organization sign-up (below) and staff creation (US-092) each write them in their own transaction.

Staff who become non-`ACTIVE` after signing in are refused on their next request by M02's `PolicyGuard`; their sessions are deleted at the moment they stop being `ACTIVE` ([US-092](#as-built--staff-administration-us-092-2026-09-18)).

## As built — organization sign-up (US-006)

**Decided 2026-09-15** ([ADR-0012](../../02-architecture/adr/0012-organization-sign-up.md)). In `apps/api/src/identity/`: `organization-sign-up.service.ts`, `organization-slug.ts` and `sign-up-rate-limiter.ts`. Both routes are public (`@AllowAnonymous`). The web form is `/sign-up`, linked from `/sign-in`.

**`POST /api/organizations`.** Body: `organizationName`, `name`, `email` (stored lower-case), `phone` (an Indian mobile, stored E.164) and `password` (10–128 characters). **No slug is sent.**

1. **Rate limit.** Five attempts an hour per client address, counted once the form has passed validation. Past that, `429 SIGN_UP_RATE_LIMITED`. The counter is in process memory: per process, and reset on restart.
2. **Availability.** An email that already has a user is `409 EMAIL_TAKEN`; a mobile already on a staff profile is `409 PHONE_TAKEN`. Both are checked before the transaction. A race that reaches the unique index is checked again, so it gets the same answers.
3. **Slug**, generated from the business name:
   - Folded to ASCII (NFKD, marks dropped), lowercased, with non-alphanumerics becoming single hyphens, cut to 48 characters. `Śrī Lakshmi Finance & Co.` → `sri-lakshmi-finance-co`.
   - A taken slug gets `-2`, `-3` and so on, reusing the first gap; past 99, a random suffix.
   - A reserved word is treated as taken. `RESERVED_SLUGS` lists every top-level web route plus words like `api`, `admin` and `rasi` — **add a new top-level route to it**.
   - A name leaving fewer than three characters gets `org-` and 8 random hex characters.
   - Losing a race for the slug retries with a fresh choice, up to three times.
4. **One transaction** creates:
   - the `organization` (`slug`, `Asia/Kolkata`, `INR`)
   - the `user` and its `credential` account, hashed with Better Auth's hasher
   - a `SUPER_ADMIN` `staff_profile` with staff code `OWNER-xxxxxxxx`, joined today (business date), and `mustChangePassword` clear
   - `CREATE` audit entries for `organization` (name, slug) and `staff_profile`, with the owner as actor

Returns `201 { organizationId, staffProfileId, slug }`. The web form signs the owner in with the same password, then shows the business's sign-in link to share with staff before going on to `/home`.

Nothing else is created: no sector, line or setting. Ledger accounts appear on first use. Sector and line codes, setting keys and business-wide holidays are unique **per organization** (migration `organization_scoped_uniques`).

**`GET /api/organizations/:slug`** returns `{ slug, name }`, or `404 ORGANIZATION_NOT_FOUND`; a malformed slug is `400`. It backs the business's sign-in link, **`/<slug>/sign-in`**, which names the business above the ordinary form. After sign-in, that page checks `GET /api/me` (which now includes `organization: { name, slug }`) and signs out an account belonging to another business, telling it to use its own link. This keeps people on the right page; it is not access control. The organization always comes from the session's staff profile (M02), and plain `/sign-in` still works for everyone.

## As built — admin password reset (US-003)

**Decided 2026-09-13: Admin-initiated reset only.** There was no email provider, so self-service "forgot password" waited until one was chosen. SMTP email now exists (M10, 2026-09-15); self-service reset through it is still unbuilt and needs its own decision, since field staff often have no inbox.

`POST /api/staff/:staffProfileId/password-reset` (permission `staff.resetPassword`) — in `apps/api/src/identity/`:

1. Generates a 12-character temporary password from an alphabet with no look-alike characters (readable over a phone), with a CSPRNG.
2. In one transaction: replaces the credential's hash (hashed by Better Auth's own hasher, so sign-in verifies it), **deletes every session the staff member holds**, sets `staff_profile.mustChangePassword`, and writes an `UPDATE` audit entry recording `passwordReset` and the number of sessions revoked.
3. Returns the temporary password **once**. It is not stored in plain text, logged, or audited.

While `mustChangePassword` is set, the temporary password signs in but **every Rasi route answers `403 PASSWORD_CHANGE_REQUIRED`**; Better Auth's `POST /api/auth/change-password` is the one thing it allows. A successful change clears the flag and audits it in one transaction.

| Refusal                     | Status | When                                        | Recorded (ADR-0014) |
| --------------------------- | ------ | ------------------------------------------- | ------------------- |
| `STAFF_NOT_FOUND`           | `404`  | Another organization, soft-deleted, missing | Yes                 |
| `CANNOT_RESET_SUPER_ADMIN`  | `403`  | An Admin targeting a Super Admin            | Yes                 |
| `CANNOT_RESET_OWN_PASSWORD` | `422`  | Use change-password instead                 | No — wrong endpoint |
| `NO_PASSWORD_CREDENTIAL`    | `422`  | The user has no password to replace         | No                  |

Forcing a reset on the owner is how an Admin would take the owner's account, so that refusal is a `security_event`, not only a `403` — added 2026-09-19 after a security review found this route recording neither of its first two refusals.

**Who am I — `GET /api/me`** (`profile.viewOwn`, every role) returns `userId`, `staffProfileId`, `name`, `email`, `role`, `currentLineId` and `organization` (`name`, `slug`). The web client calls it on every signed-in page. `401` sends the user to `/sign-in`, and `403 PASSWORD_CHANGE_REQUIRED` sends them to `/change-password`. Otherwise the client forwards to the role's landing: `/dashboard` in the console for Super Admin, Admin and Senior, and `/route` for Junior. The client only follows the API's answer and decides nothing itself.

**Team read model — `GET /api/staff`** (`?role=`, `?status=`) **and `GET /api/staff/:staffProfileId`** (both `staff.list`):

- Each person comes with the line they work today.
- The detail adds their assignment history, newest first, with `upcoming` set on rows that start after today.
- Scope is `staffScope`: Admins see their organization; a Senior sees staff whose assignment in effect today is on their line, and only that line's history rows (`assignmentScope`).
- Soft-deleted staff are never returned. Anything out of scope is `404 STAFF_NOT_FOUND`, identical to a missing id.
- Changing any of it is [US-092](#as-built--staff-administration-us-092-2026-09-18), below.

Better Auth checks the `Origin` header on its POST endpoints (`trustedOrigins` is the web origin). A request without it gets `403 MISSING_OR_NULL_ORIGIN`, so test sign-in or change-password with curl by sending `Origin` explicitly.

**Sign-out (US-002)** is Better Auth's `POST /api/auth/sign-out`, unchanged: it deletes that device's session row, so a retained cookie is refused afterwards, and leaves the staff member's other sessions alone. The rule that sign-out is blocked while unsynced collections are queued belongs to the client and arrives with the offline outbox (Phase 3).

## As built — staff administration (US-092, 2026-09-18)

In `apps/api/src/identity/staff-admin.service.ts`, on the Team read model above. Four routes, each audited as `staff_profile` inside its own transaction, each returning the same `StaffDetail` the Team screens already read:

| Route                                    | Permission         | Roles       |
| ---------------------------------------- | ------------------ | ----------- |
| `POST /api/staff`                        | `staff.create`     | Admin+      |
| `PATCH /api/staff/:staffProfileId`       | `staff.update`     | Admin+      |
| `POST /api/staff/:staffProfileId/role`   | `staff.changeRole` | Super Admin |
| `POST /api/staff/:staffProfileId/status` | `staff.suspend`    | Admin+      |

`staff.update` is a **new permission and a new matrix row** ("Update staff details"), for what the Operations table above already assigned to Admin+.

**Four safety rules**, each an API-level test and none of them a hidden button:

1. **Never a role above your own.** Roles rank `SUPER_ADMIN < ADMIN < SENIOR < JUNIOR`. Creating or granting a role senior to the caller's is `403 ROLE_ABOVE_OWN`; acting on someone who holds one is `403 CANNOT_MANAGE_HIGHER_ROLE`. So an Admin may create another Admin but not a Super Admin, and may not edit, suspend or reset the owner. Without this, `staff.create` alone is a self-promotion.
2. **Never yourself.** `422 CANNOT_CHANGE_OWN_ROLE` and `422 CANNOT_CHANGE_OWN_STATUS` — a Super Admin cannot demote themselves, and nobody can sign themselves out of their own access. Correcting your own name or mobile number is allowed; it grants nothing.
3. **Losing access is never silent.** Leaving `ACTIVE` deletes every session the staff member holds, so an outbox still on their phone can never be drained. If they hold a line assignment in effect or starting later, or `device_sync_report.unsentCount > 0`, the change is `422 STAFF_ON_DUTY` with one `details` entry per reason. Resending with `acknowledgeOnDuty: true` proceeds, and what was left open comes back in the response (`openAssignment`, `unsyncedWork`) and in the audit entry (`openAssignmentLeft`, `unsyncedAtChange`). **The assignment is reported, not closed** — closing it on the day of suspension would move a date collections are already attributed by (M03, BR-15), so reassigning the line stays a deliberate M03 act.
4. **One password flow.** A new staff member is created with a temporary password from `generateTemporaryPassword`, returned once and `mustChangePassword` set — the same forced change an Admin reset uses (US-003). No password is ever chosen by the Admin or sent in a request body.

**Creating** writes the `user`, its `credential` account and the `staff_profile` in one transaction, with `createdByUserId` and a generated staff code (`JR-…`, `SR-…`, `AD-…`, `SA-…`, globally unique like the owner's `OWNER-…`). Codes are **not chosen by the Admin**: a business with its own numbering has no rule the system could honour. `joinedAt` defaults to today's business date and may be earlier but never later (`422 JOINED_IN_FUTURE`), because an assignment cannot begin before it (M03). A taken email is `409 EMAIL_TAKEN` and a taken mobile `409 PHONE_TAKEN`, checked before the transaction and again if a race reaches the unique index — the same answers sign-up gives.

**Changing a role** is refused while a line assignment the new role could not hold is still open: `422 STAFF_HAS_OPEN_ASSIGNMENT`, naming the line. `line_assignment.assignmentRole` is fixed from the staff member's role when it is made, so a Senior turned Junior would otherwise remain a line's Senior. Read inside the transaction, so a concurrent assignment either loses or is seen. Nothing is revoked: `RequestContextResolver` reads the role on every request, so the change is already immediate.

| Refusal                               | Status | When                                                      |
| ------------------------------------- | ------ | --------------------------------------------------------- |
| `STAFF_NOT_FOUND`                     | `404`  | Another organization, soft-deleted, missing               |
| `ROLE_ABOVE_OWN`                      | `403`  | Creating or granting a role senior to your own            |
| `CANNOT_MANAGE_HIGHER_ROLE`           | `403`  | Acting on someone senior to you                           |
| `CANNOT_CHANGE_OWN_ROLE`              | `422`  | Your own role                                             |
| `CANNOT_CHANGE_OWN_STATUS`            | `422`  | Your own status                                           |
| `STAFF_ON_DUTY`                       | `422`  | Open assignment or unsynced collections, not acknowledged |
| `STAFF_HAS_OPEN_ASSIGNMENT`           | `422`  | The new role contradicts an open assignment               |
| `ROLE_UNCHANGED` / `STATUS_UNCHANGED` | `422`  | Already that role or status                               |
| `JOINED_IN_FUTURE`                    | `422`  | `joinedAt` after today's business date                    |
| `EMAIL_TAKEN` / `PHONE_TAKEN`         | `409`  | Already a user, or already a staff member's mobile        |

**The console** is S-14, extended rather than duplicated: "Add staff" on `/team` (Admin+) opens a dialog whose second step shows the temporary password once; `/team/:staffProfileId` adds "Edit details", "Change role" (Super Admin), and "Suspend"/"Reactivate" last in the header, each behind a confirmation naming the consequence. `STAFF_ON_DUTY` becomes a second dialog listing each reason before `acknowledgeOnDuty` is offered.

**`INACTIVE` has no console control yet.** The endpoint accepts it — "they have left the business", as distinct from a suspension — but the screen offers only Suspend and Reactivate, which is what the matrix names.

**Notifications are not raised.** M01's `staff.created`, `staff.suspended` and `staff.role_changed` events have no consumer besides M13, which is served by the audit entry; adding notices is an M10 decision, not an implicit one.

---

## Deferred

Phone + OTP or PIN sign-in for field staff, using Better Auth's `phoneNumber` plugin. `staff_profile.phone` already exists, so this is an additive change. Deferred with the localisation pack — email/password is workable for v1 because staff accounts are Admin-created and few.

---

## Risks

| Risk                                                   | Mitigation                                                                                                           |
| ------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------- |
| The NestJS Better Auth adapter is community-maintained | Better Auth exposes a plain node handler; replacing the adapter with a hand-written controller is a contained change |
| Field staff may not have email addresses               | Admin-initiated password reset; phone sign-in is the Phase-2 answer                                                  |
| Long sessions widen the window on a stolen device      | Immediate server-side revocation on suspend; device list visible to the user                                         |
