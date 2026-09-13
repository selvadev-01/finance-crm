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

## Deferred

Phone + OTP or PIN sign-in for field staff, using Better Auth's `phoneNumber` plugin. `staff_profile.phone` already exists, so this is an additive change. Deferred with the localisation pack — email/password is workable for v1 because staff accounts are Admin-created and few.

---

## Risks

| Risk                                                   | Mitigation                                                                                                           |
| ------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------- |
| The NestJS Better Auth adapter is community-maintained | Better Auth exposes a plain node handler; replacing the adapter with a hand-written controller is a contained change |
| Field staff may not have email addresses               | Admin-initiated password reset; phone sign-in is the Phase-2 answer                                                  |
| Long sessions widen the window on a stolen device      | Immediate server-side revocation on suspend; device list visible to the user                                         |
