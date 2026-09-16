# ADR-0007 — Better Auth, mounted in the NestJS API

**Status:** Accepted · 2026-09-12

## Context

Rasi needs authentication for about 60 staff across four roles. Accounts are Admin-created; there is no public sign-up and no customer login.

> **Amended by [ADR-0012](0012-organization-sign-up.md):** the owner of a new organization signs up publicly, rate-limited, through a Rasi endpoint. Better Auth's own sign-up stays disabled; staff are still Admin-created.

Two questions had to be answered together: which library, and where it lives. The repository has NestJS as the API with `packages/db` owning the Prisma schema, and Next.js as the front end — and Better Auth can be hosted in either.

## Decision

**Better Auth, instantiated in `apps/api`** and mounted via `@thallesp/nestjs-better-auth`. NestJS serves `/api/auth/*`. There is no auth route handler in the Next.js application.

Better Auth handles **identity only**. Roles, line scoping and the permission matrix are Rasi's, in `staff_profile` and the policy layer ([M02](../../01-product/modules/M02-access-control.md)).

## Consequences

**Good**

- `packages/db` (`@repo/db`) remains the sole owner of the Prisma schema. One process touches it, one migration history
- The Junior PWA replays queued requests with a plain first-party cookie — no token handling in the service worker ([offline-sync](../offline-sync.md))
- Auth sits behind the same guards and logging as every other endpoint
- Generated auth tables stay untouched, so `better-auth generate` is re-runnable across upgrades
- The `phoneNumber` plugin is a documented upgrade path for field-staff sign-in

**Bad**

- `@thallesp/nestjs-better-auth` is community-maintained, not official. Pinned, and contained: Better Auth exposes a plain node handler, so replacing the adapter with a hand-written controller is a small change
- `bodyParser: false` is required at bootstrap and fails obscurely if removed. Documented at the call site, with a smoke test in the api suite that fails if it goes
- **`npx auth migrate` does not work with the Prisma adapter** — the CLI `generate`s, Prisma migrates ([authentication](../authentication.md#migrations--npx-auth-migrate-does-not-work-here))
- Better Auth claims the table name `account`, colliding with Rasi's term for a loan. Resolved by naming the entity `account_loan` while keeping "Account" in all user-facing text

## Alternatives considered

**Better Auth hosted in Next.js.** Rejected. `apps/web` would need its own Prisma client against the same database, so two applications write auth tables — and the offline outbox would have to carry a bearer token rather than replaying with a cookie, adding token refresh logic to a service worker.

**Next.js as a BFF proxying to NestJS.** Rejected. Keeps cookies simple but adds a hop to every request and prevents the PWA from reaching the API directly, which hurts offline replay most.

**NestJS Passport + hand-rolled JWT.** The conventional choice, rejected as more code to own for less capability. Sessions, password reset, verification and device handling all become ours to maintain.

**Better Auth's admin plugin for roles.** Rejected. Rasi's roles carry line-scoping rules the plugin does not model, and assignment history ([M03](../../01-product/modules/M03-org-structure.md)) is needed regardless. Splitting authorisation across two systems to save one table would make every scoping question harder to answer.
