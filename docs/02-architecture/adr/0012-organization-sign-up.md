# ADR-0012 — Public organization sign-up, with generated slugs

**Status:** Accepted · 2026-09-15 · Amends the "no public sign-up" rule of [ADR-0007](0007-better-auth.md) and [M01](../../01-product/modules/M01-identity.md), and the single-organization scope in [vision](../../00-overview/vision.md) and the [ERD](../../03-data/erd.md)

## Context

Rasi was specified for one business: `organization` held a single row, and every staff account was created by an Admin. That left no way to start. On a fresh database nobody can sign in to create the first Admin. The only ways to get a login were the seed dataset, which writes permanent demo collections and ledger rows, or hand-written SQL.

The owner asked for businesses to sign up from the app, the way B2B SaaS products do. Three questions followed:

- **How is a business identified outside the app?** Staff need a link to their own business's sign-in page.
- **How is open sign-up protected** without a secret the owner has to type?
- **What in the schema assumed one business?** Sector codes, line codes, setting keys and the business-wide holiday date were unique across the whole database.

How others do it, checked on 2026-09-15:

- One shared schema with an organization key on every table, and uniqueness scoped to the organization ([WorkOS](https://workos.com/blog/developers-guide-saas-multi-tenant-architecture)).
- A unique slug per organization, used in URLs, which never authorizes anything on its own ([Clerk](https://clerk.com/docs/guides/organizations/org-slugs-in-urls), [Better Auth organization plugin](https://better-auth.com/docs/plugins/organization)).
- Reserved words kept out of slugs ([GitHub](https://github.com/Mottie/github-reserved-names)).
- Layered sign-up protection, starting with rate limiting.

A first version gated sign-up behind a deployment setup key. The owner rejected it: no real product asks its customers for one.

## Decision

**A public `POST /api/organizations` creates an organization and its owner as `SUPER_ADMIN`, in one transaction. The organization gets a slug generated from its name, and sign-up is rate-limited per address.**

- **The slug is generated, never typed.**
  - It is the name folded to ASCII, lowercased, with hyphens between words, at most 48 characters.
  - A name already taken gets `-2`, `-3` and so on. A name that leaves fewer than three characters (one written in Tamil script, say) gets a random `org-xxxxxxxx`.
  - Reserved words — every top-level web route, `api`, `admin`, `rasi` and similar — are treated as taken.
  - The database decides in the end: `organization_slug_key` is unique, and `organization_slug_format_check` requires lowercase alphanumeric groups joined by single hyphens, 3–63 characters.
  - A sign-up that loses a race for the slug retries with a fresh choice, up to three times.
  - Rows created outside sign-up (the seed, test fixtures, older rows) get a random `org-` slug from the column default.
- **The slug appears in one URL: the business's sign-in link, `/<slug>/sign-in`.**
  - The page names the business, looked up through the public `GET /api/organizations/:slug`, which returns only the slug and name.
  - After sign-in it checks, through `GET /api/me`, that the account belongs to that business, and signs anyone else back out.
  - **The slug authorizes nothing.** The organization always comes from the session's staff profile (M02), and the plain `/sign-in` still works.
  - App URLs do not carry the slug. The Junior's offline app is scoped to `/route` ([ADR-0008](0008-offline-first-pwa.md)) and must not move.
- **Protection is a rate limit: five sign-up attempts an hour per client address**, counted before any database work. A malformed form is refused by validation first and does not count. The counter lives in process memory, which fits one API process ([ADR-0003](0003-worker-in-api-process.md)).
- **The owner chooses their own password** and is signed in at once; `mustChangePassword` is not set.
  - Better Auth's `disableSignUp` stays on: the route writes `user` and `account` itself, hashing with Better Auth's own hasher, inside Rasi's transaction.
  - Both records are audited: `organization CREATE` (with the slug) and `staff_profile CREATE`, with the owner as actor.
- **Everyone else is still created by an Admin** (US-092). Sign-up makes owners, never staff.
- **Codes are unique per organization.** Migration `organization_scoped_uniques` rebuilds the unique indexes on `sector.code`, `line.code`, `setting.key` and the `holiday` date as `(organizationId, …)`. Customer and account codes keep their shared sequences: still unique everywhere, which costs nothing.

## Consequences

**Good**

- A fresh deployment gets its first login from the app, with no seed and no SQL
- A second real business runs on the same deployment with its own codes, and its own sign-in link to share
- The owner types nothing they have to invent: the business name becomes the link

**Bad**

- **The rate limit is per process and forgets on restart.** Running more than one API process needs a shared counter (a PostgreSQL table would do) before it is relied on
- **No email verification.** Anyone can sign up with an address they do not own. The account is useless to them, but it blocks the real owner of that address from signing up. SMTP email now exists (M10, 2026-09-15) and sends the owner a welcome email; verifying the address before the organization is usable is the next layer, not yet built
- **A slug is fixed once issued.** Renaming the business does not change the link, and there is no rename endpoint. Changing a slug later means deciding what happens to links already shared
- **Slugs reveal business names.** Anyone who guesses a slug learns the name behind it, as with Slack workspace URLs. Nothing else is exposed
- **Email and staff phone stay globally unique**, and one user belongs to one organization. A person cannot own two businesses with the same email. A membership table, as in Better Auth's organization plugin, is the path if that is ever needed

## Alternatives considered

**A deployment setup key.** Built first, then rejected by the owner. A shared secret passed out of band is not how customers expect to sign up.

**The owner types the slug.** Rejected by the owner. It asks them to invent an identifier for no benefit, and makes them fix collisions by hand.

**Slugs in every URL (`/<slug>/customers`) or as subdomains.** Rejected for now:

- Every console route and link would move.
- The offline service worker's `/route` scope would have to move with them, the highest-risk path in the system.
- Subdomains add wildcard DNS and per-subdomain cookies.

The slug's format is already a valid DNS label, so subdomains remain possible later.

**Better Auth's organization plugin.** Not adopted. Its `member` table supports many organizations per user, which Rasi does not need yet. Adopting it would split organization membership across Better Auth's tables and `staff_profile`, while Rasi's roles and line scoping live in `staff_profile` ([ADR-0007](0007-better-auth.md)).

**Email verification before the organization exists.** Deferred: it needs an email provider, and none is chosen.
