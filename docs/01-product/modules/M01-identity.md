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

- A staff member is created by an Admin, never self-registered. There is no public sign-up.
- Role is single-valued — Senior or Junior, never both.
- `status` gates sign-in: only `ACTIVE` may authenticate. `SUSPENDED` and `INACTIVE` are refused with a message that does not reveal whether the password was correct.
- Soft delete (`deletedAt`) is blocked while the staff member holds an open line assignment or has unacknowledged cash.

### Session duration is a field-driven decision

Sessions last **30 days with rolling renewal**, far longer than a typical web application.

> A Junior signs in once and works for weeks without thinking about it. An expiring session is not an inconvenience for them — it is a hard stop, because re-authentication needs connectivity and they may have none. A session that expires overnight strands a collector with a full route and no way to record anything.
>
> The compensating control is that suspension takes effect immediately server-side: revoking access does not wait for a session to expire.

---

## Operations

| Operation                | Actor                | Notes                                                                                       |
| ------------------------ | -------------------- | ------------------------------------------------------------------------------------------- |
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

**Public sign-up is disabled** (`disableSignUp`). Users with credentials are created server-side through Better Auth's internal adapter — the path US-092 staff creation will take, and the one the test helpers use.

Staff who become non-`ACTIVE` after signing in are refused on their next request by M02's `PolicyGuard`; revoking their sessions at suspension is part of US-092.

## As built — admin password reset (US-003)

**Decided 2026-09-13: Admin-initiated reset only.** There is no email provider, so self-service "forgot password" waits until one is chosen.

`POST /api/staff/:staffProfileId/password-reset` (permission `staff.resetPassword`) — in `apps/api/src/identity/`:

1. Generates a 12-character temporary password from an alphabet with no look-alike characters (readable over a phone), with a CSPRNG.
2. In one transaction: replaces the credential's hash (hashed by Better Auth's own hasher, so sign-in verifies it), **deletes every session the staff member holds**, sets `staff_profile.mustChangePassword`, and writes an `UPDATE` audit entry recording `passwordReset` and the number of sessions revoked.
3. Returns the temporary password **once**. It is not stored in plain text, logged, or audited.

While `mustChangePassword` is set, the temporary password signs in but **every Rasi route answers `403 PASSWORD_CHANGE_REQUIRED`**; Better Auth's `POST /api/auth/change-password` is the one thing it allows. A successful change clears the flag and audits it in one transaction.

| Refusal                     | Status | When                                        |
| --------------------------- | ------ | ------------------------------------------- |
| `STAFF_NOT_FOUND`           | `404`  | Another organization, soft-deleted, missing |
| `CANNOT_RESET_SUPER_ADMIN`  | `403`  | An Admin targeting a Super Admin            |
| `CANNOT_RESET_OWN_PASSWORD` | `422`  | Use change-password instead                 |
| `NO_PASSWORD_CREDENTIAL`    | `422`  | The user has no password to replace         |

**Sign-out (US-002)** is Better Auth's `POST /api/auth/sign-out`, unchanged: it deletes that device's session row, so a retained cookie is refused afterwards, and leaves the staff member's other sessions alone. The rule that sign-out is blocked while unsynced collections are queued belongs to the client and arrives with the offline outbox (Phase 3).

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
