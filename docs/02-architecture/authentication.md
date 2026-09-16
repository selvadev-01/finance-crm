# Authentication

Better Auth, mounted in the NestJS API. Decision and alternatives in [ADR-0007](adr/0007-better-auth.md).

**Verified against better-auth.com/docs on 2026-09-12.** Pin the version in `package.json` and re-check this document on any major upgrade — the CLI behaviour described below is version-specific.

---

## Placement

Better Auth is instantiated in `apps/api` and mounted via `@thallesp/nestjs-better-auth`. NestJS serves `/api/auth/*`.

**There is no `app/api/auth/[...all]/route.ts` in the Next.js app.** That handler belongs in Next.js only when Better Auth is hosted there. Here the API owns it.

> Mounting in the API keeps `packages/db` the sole owner of the Prisma schema. Hosting auth in Next.js would mean two applications holding Prisma clients against the same database and both writing auth tables — and the offline outbox would need to carry a bearer token rather than replaying with a plain cookie.

---

## Files

| Path                               | Contents                                    |
| ---------------------------------- | ------------------------------------------- |
| `apps/api/src/auth/auth.config.ts` | The `betterAuth()` instance                 |
| `apps/api/src/auth/auth.module.ts` | `AuthModule.forRoot({ auth })`              |
| `apps/web/src/lib/auth-client.ts`  | `createAuthClient` from `better-auth/react` |

### `auth.config.ts`

```ts
import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { prisma } from "@repo/db";

export const auth = betterAuth({
  database: prismaAdapter(prisma, { provider: "postgresql" }),
  // No Better Auth sign-up: staff are created by an Admin (M01), and an
  // organization's owner through Rasi's POST /api/organizations (ADR-0012).
  emailAndPassword: { enabled: true, disableSignUp: true },
  // Only ACTIVE staff sign in; every attempt writes a LOGIN audit entry.
  hooks: createSignInHooks(prisma),
  session: {
    expiresIn: 60 * 60 * 24 * 30, // 30 days — see below
    updateAge: 60 * 60 * 24, // rolling renewal
  },
  trustedOrigins: [process.env.WEB_ORIGIN!],
  // Social providers are configured only when OAuth credentials exist in env.
  // For a field-staff application they are not expected to be used.
});
```

Uses the **existing** Prisma client from `packages/db`. No new database, no second connection.

### Mounting

```ts
// main.ts
const app = await NestFactory.create(AppModule, { bodyParser: false });
```

```ts
// app.module.ts
AuthModule.forRoot({ auth });
```

Two details that fail quietly if missed:

- **`bodyParser: false` is mandatory.** Better Auth needs the raw request body; leaving Nest's parser enabled breaks every auth route with no obvious cause.
- **It is global, so every other endpoint loses JSON parsing too.** The API design assumes parsed JSON bodies everywhere else, so `configureApp` (`apps/api/src/platform/configure-app.ts`, called by `main.ts` and every HTTP test) re-adds `express.json()` for all paths that do _not_ start with `/api/auth`. Removing that middleware breaks every non-auth `POST` instead.
- **`forRoot({ auth })` takes an object** in v2.x. The older `forRoot(auth)` signature is wrong and will not work.

### Guards and decorators

The library's own global `AuthGuard` is disabled (`disableGlobalAuthGuard`). **M02's `PolicyGuard` is the only global guard**: it lets `@AllowAnonymous()` routes through without touching the session, then runs the library's session check through `RasiAuthGuard` (`apps/api/src/auth/rasi-auth.guard.ts`), then staff status, permission and — in repositories — scope ([M02 as built](../01-product/modules/M02-access-control.md#as-built)). The library guard on its own resolves the session — a database query — _before_ checking whether a route is public, which would make `/health/live` fail whenever the database is down.

| Decorator                     | Purpose                                                  |
| ----------------------------- | -------------------------------------------------------- |
| `@AllowAnonymous()`           | Public route                                             |
| `@RequirePermission(p)` (M02) | Session, `ACTIVE` staff and a role holding `p`           |
| `@CurrentContext()` (M02)     | The resolved `RequestContext`, for repository calls      |
| `@Session()`                  | The Better Auth session, on a `@RequirePermission` route |

Every route carries `@AllowAnonymous()` or `@RequirePermission`; the application will not start otherwise. `@OptionalAuth()` is not supported — a route that works without a session is public. Better Auth answers _who you are_; it never answers _what you may do_.

---

## Session duration

30 days, rolling. Far longer than a typical web application, and deliberate.

> A Junior signs in once and works for weeks. Session expiry is not an inconvenience for them — it is a hard stop, because re-authentication needs connectivity and they may have none. A session expiring overnight strands a collector with a full route and no way to record anything.
>
> The compensating control is immediate server-side revocation: suspending a staff member kills their sessions at once rather than waiting for expiry.

---

## Migrations — `npx auth migrate` does not work here

Better Auth's documentation lists **Prisma schema migration as not supported** by its CLI. With the Prisma adapter the CLI generates the schema; Prisma applies it.

```bash
# 1. Write auth models into packages/db/prisma/schema.prisma
npx @better-auth/cli generate

# 2. Apply with Prisma's own tooling
pnpm --filter @repo/db exec prisma migrate dev --name add-better-auth

# 3. Refresh the client
pnpm --filter @repo/db exec prisma generate
```

**The generated models are not authored by hand, with one necessary exception.** Step 1 has to stay re-runnable across Better Auth upgrades, so nothing may be added to them freely. But Prisma requires both sides of every relation, and the Rasi models point at `User` — so `model User` must carry back-relation fields (`staffProfile`, `notifications`, `pushSubscriptions`) or the schema does not compile.

The enforceable rule is therefore narrower than "do not edit": **relation fields only, never scalar columns.** All Rasi staff data lives in `staff_profile`, keyed 1:1 to `user` (M01). Commit the freshly generated file on its own before adding the back-relations, so `git log -p` on the schema stays the record of every hand-edit to replay after an upgrade.

**The `@better-auth/cli` package is abandoned.** It tops out at `1.4.22` while `better-auth` itself is at `1.7.4`, and npm reports it deprecated. It still generates correct models, because it derives tables from the _installed_ `better-auth` rather than from its own version — but pin `better-auth`, review the generated diff on every regeneration, and expect to hand-maintain these four models if the CLI stops working entirely.

---

## Table naming collision

Better Auth claims the model name `Account` for OAuth provider links. Rasi's loan is also called an "Account" throughout the source document.

**Resolution:** the loan entity is `AccountLoan` / table `account_loan` in the database, and remains **"Account"** in every piece of user-facing text. Recorded in the [glossary](../00-overview/glossary.md#money) so it does not ambush a developer later.

---

## Cookies and origins

Same-origin in production: Nginx serves the web app at `/` and the API at `/api`, so the session cookie is first-party.

> Third-party cookie restrictions are tightening, and the Junior PWA replaying queued requests from a service worker is exactly where a cross-site cookie fails quietly. One origin removes the problem instead of configuring around it.

**Development is same-origin too.** `apps/web` proxies `/api/:path*` to `:3001` via `rewrites()` in `next.config.js`, so the browser only ever talks to `http://localhost:3000` and the cookie is first-party in both environments.

> An earlier version of this document prescribed `sameSite: "none"` plus `secure: true` for development across the two ports. That configuration cannot work: `secure` cookies are not accepted over plain HTTP, and the dev ports are HTTP. Worse, it made development exercise a different cookie path from production — in exactly the place this document warns a cross-site cookie fails quietly. The proxy removes the special case rather than configuring around it.

Cookie settings: `httpOnly`, `sameSite: "lax"`, `path: "/"`, and `secure` only when `NODE_ENV === "production"`.

`baseURL` is set to `WEB_ORIGIN`. Without it Better Auth derives its origin from each incoming request and warns at startup, which makes callbacks and redirects unreliable.

---

## What Better Auth does not own

| Concern                 | Owner                      |
| ----------------------- | -------------------------- |
| Roles                   | `staff_profile.role` (M01) |
| Line and sector scoping | M02 + M03                  |
| Permission matrix       | M02                        |
| Staff metadata          | `staff_profile`            |

> Better Auth's admin plugin offers roles and access control, and they are not used. Rasi's roles are business data that change with line reassignments and carry scoping rules the plugin does not model — and the assignment-history tables (M03) would be needed regardless. Splitting authorisation across two systems to save one table would make every scoping question harder to answer.

---

## Deferred

**Phone + OTP or PIN sign-in** for field staff, via Better Auth's `phoneNumber` plugin. `staff_profile.phone` already exists; this is additive. Deferred with the localisation pack — email/password works for v1 because staff accounts are Admin-created and few.

---

## Risks

| Risk                                                                 | Mitigation                                                                                                                  |
| -------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `@thallesp/nestjs-better-auth` is community-maintained, not official | Better Auth exposes a plain node handler; replacing the adapter with a hand-written controller is contained. Version pinned |
| `bodyParser: false` removed by a future refactor                     | Documented here and in a code comment at the call site; an auth smoke test in the api suite fails if it goes                |
| Better Auth upgrade changes generated schema                         | Generated models never hand-edited; upgrade runs `generate` then reviews the migration diff                                 |
| Cross-origin cookie misconfiguration reaches production              | Same-origin in production; dev-only settings gated by `NODE_ENV`                                                            |
