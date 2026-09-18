# Security

Rasi holds the financial records of 1,000+ people and controls a daily cash chain. The threat model is dominated by **insiders**, not anonymous attackers.

---

## Threat model

| Threat                                                     | Likelihood | Impact   | Primary control                                           |
| ---------------------------------------------------------- | ---------- | -------- | --------------------------------------------------------- |
| Staff member alters a past collection to cover a shortfall | **High**   | High     | Append-only collections (BR-14); no update path exists    |
| Junior views another line's customers                      | Medium     | Medium   | Server-side scoping (M02)                                 |
| Lost or stolen field device                                | **High**   | Medium   | Session revocation, no cached profit data, device list    |
| Admin manipulates figures                                  | Low        | High     | Audit log; write-off restricted to Super Admin            |
| Credential sharing among staff                             | **High**   | Medium   | Per-user audit attribution; device list visible           |
| Database compromise                                        | Low        | Critical | Encryption at rest, restricted network, backup encryption |
| Internet-facing attack                                     | Medium     | Medium   | Standard web hardening                                    |

> The highest-likelihood threats are all internal, and all of them are addressed by structure rather than by monitoring. Append-only records mean the fraudulent edit cannot be made, rather than being detectable after the fact.

---

## Authentication

Better Auth ([`authentication.md`](authentication.md)).

| Control                 | Setting                                                                                                                                                                                                          |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Password hashing        | Better Auth default (scrypt)                                                                                                                                                                                     |
| Minimum password length | 10 characters                                                                                                                                                                                                    |
| Session                 | 30 days, rolling, `httpOnly` + `secure` + `sameSite: lax`                                                                                                                                                        |
| Sign-in rate limit      | 5 per 15 min per IP                                                                                                                                                                                              |
| Revocation              | Immediate on suspend — does not wait for expiry                                                                                                                                                                  |
| Self-registration       | **Disabled** for staff, who are Admin-created. A business's owner signs up publicly, rate-limited to five attempts an hour per address; no email verification yet ([ADR-0012](adr/0012-organization-sign-up.md)) |

**Long sessions are a field requirement, not laxity** — a Junior with an expired session and no connectivity cannot work. The compensating control is immediate revocation.

**Generic sign-in failures.** A suspended account and a wrong password return the same message; account state is not enumerable.

---

## Authorisation

Two independent checks per request — action, then row scope — both server-side (M02).

**Scoping is injected at the repository layer**, so an unscoped query must be written deliberately rather than obtained by forgetting.

**UI hiding is convenience, never a control.** Every hidden action independently fails at the API, and every cell of the [RBAC matrix](../01-product/rbac-matrix.md) is an API-level test. PRD gate 5 depends on this.

**Out-of-scope rows return `404`**, so a Junior probing IDs learns nothing about what exists.

---

## Data protection

| Data                    | Handling                                     |
| ----------------------- | -------------------------------------------- |
| Passwords               | Hashed, never logged, never returned         |
| Session tokens          | `httpOnly` cookies, unreadable by JavaScript |
| Push subscription keys  | Encrypted at rest, redacted from logs        |
| Customer mobile numbers | Stored plain — operationally required        |
| Money amounts           | `NUMERIC(14,2)`, logged as strings           |
| FCM service account     | Environment only, never committed            |

**Encryption at rest** on the database volume and on backups. **TLS 1.2+** everywhere, HSTS enabled.

**Log redaction is allowlist-based** (M16): a denylist is a list of the leaks you thought of.

---

## Field device risk

The realistic loss scenario: a Junior's phone is stolen with a live session and a cached route.

| Control                              | Effect                                       |
| ------------------------------------ | -------------------------------------------- |
| No profit or invested amounts cached | The margin on customers is not on the device |
| Route cache expires after 72 hours   | Stale data self-destructs                    |
| Immediate session revocation         | Admin suspends, access dies at once          |
| Device list visible to the user      | Unknown devices are noticeable               |
| No offline read of other lines       | Scope is enforced before caching             |

> A stolen phone exposes one Junior's route — names, addresses and amounts due — which is the same information they carry on paper today. It does not expose business totals, other lines, or customer margins. Reducing that exposure to the same level as the paper it replaces is the realistic goal; making it zero would mean no offline capability at all.

---

## Input validation

Every endpoint validates against its Zod contract schema (`packages/contracts`). Rejection happens before the handler runs.

- Prisma parameterises all queries; no raw SQL with interpolation
- Output is escaped by React; no `dangerouslySetInnerHTML`
- Uploads are not supported in v1, removing that class entirely
- Money fields accept only the decimal-string format, rejecting scientific notation and `NaN`

---

## Web hardening

| Control       | Setting                                                         |
| ------------- | --------------------------------------------------------------- |
| CSP           | `default-src 'self'`; no inline scripts                         |
| CSRF          | `sameSite: lax` cookies; state-changing requests require `POST` |
| Clickjacking  | `X-Frame-Options: DENY`                                         |
| MIME sniffing | `X-Content-Type-Options: nosniff`                               |
| Referrer      | `strict-origin-when-cross-origin`                               |
| Rate limiting | Per-endpoint ([api-design](api-design.md#rate-limiting))        |

**The collection endpoint's rate limit is deliberately high** (300/min/user) — a Junior reconnecting after a day offline legitimately submits a hundred collections in seconds. Throttling the sync path would break the core offline guarantee.

---

## Secrets

Environment variables, never committed. `.env.example` documents names with placeholder values only.

| Secret                  | Rotation                                            |
| ----------------------- | --------------------------------------------------- |
| `BETTER_AUTH_SECRET`    | On suspicion — invalidates all sessions             |
| `DATABASE_URL` password | Quarterly                                           |
| `VAPID_PRIVATE_KEY`     | **Avoid** — rotation invalidates every subscription |
| `FCM_PRIVATE_KEY`       | On suspicion                                        |

> VAPID key rotation forces every device to re-register. It is documented as a last resort, and the keypair is backed up separately from the repository — losing it has the same effect as rotating it.

A committed secret is treated as compromised and rotated, not merely removed from the working tree.

---

## Audit

Every action that changes state is recorded with actor, before/after, IP and timestamp (M13), written **in the same transaction** as the change.

The audit log is append-only and writable by no role. Retention 7 years.

Sign-ins, including failures, are audited — repeated failures for one account are the clearest signal of credential sharing or an attempted takeover.

---

## Backup and recovery — deferred, not optional

Hosting and backups are decided after the application is built. The requirement is recorded here so it is not rediscovered at go-live:

| Control          | Requirement                            |
| ---------------- | -------------------------------------- |
| Full backup      | Nightly, encrypted                     |
| WAL archiving    | Continuous, for point-in-time recovery |
| Retention        | 30 days minimum                        |
| Off-site copy    | Required                               |
| **Restore test** | **Before going live, then quarterly**  |

> For a business whose complete financial record — every account, every collection, every ledger posting — lives in one PostgreSQL database, this is the last line of defence and the only control on this page that nothing else compensates for.
>
> The test is a **restore**, not a backup. An untested backup is a hope. Verify by actually restoring to a scratch database and signing in against it.

**During development** the dataset is seeded and disposable — `pnpm db:reset` rebuilds it, and nothing on a development machine needs backing up. That is exactly why this discipline has to be established deliberately before the first real customer is entered, rather than inherited from habit.

---

## Dependencies

- `pnpm audit` run deliberately before each release; high and critical findings block it
- Exact versions pinned via `pnpm-lock.yaml`, with `packageManager` pinning pnpm itself
- `@thallesp/nestjs-better-auth` is community-maintained — pinned and reviewed on upgrade

---

## Not in v1

| Deferred                  | Reason                                                                                    |
| ------------------------- | ----------------------------------------------------------------------------------------- |
| Two-factor authentication | Adds a second factor field staff may not have. Worth revisiting once phone sign-in exists |
| IP allowlisting for Admin | Admins work from varied locations                                                         |
| Field-level encryption    | Database-level encryption is proportionate at this scale                                  |
| Penetration test          | Recommended after launch, before scaling beyond the current business                      |

> Listed rather than omitted so their absence is a decision on record, not an oversight.
