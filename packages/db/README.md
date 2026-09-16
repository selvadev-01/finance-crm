# `@repo/db`

Prisma schema, migrations and the client. **Sole owner of the database schema** — no other package defines tables.

## Local setup

PostgreSQL is installed natively, no Docker. **One database, one schema** — `public` in `rasi_dev`, shared by `pnpm dev` and the test suite through `DATABASE_URL`.

One-time creation, as a superuser:

```sql
CREATE ROLE rasi WITH LOGIN CREATEDB PASSWORD '...';
CREATE DATABASE rasi_dev OWNER rasi;
```

`CREATEDB` is required: `prisma migrate dev` creates and drops a shadow database to diff migrations against.

For the job queue (M14), also as a superuser, once:

```sql
CREATE SCHEMA pgboss AUTHORIZATION rasi;
```

pg-boss creates and migrates its own tables there when a worker starts. Prisma does not manage that schema, so the migration drift check is unaffected.

Then copy `.env.example` to `.env` at the repository root and fill in the password. Apply migrations with `pnpm --filter @repo/db db:deploy` — the test suite checks for pending migrations and refuses to run, but never applies them itself.

## Scripts

| Script        | What it does                                                 |
| ------------- | ------------------------------------------------------------ |
| `db:generate` | Regenerate the client into `src/generated`                   |
| `db:migrate`  | `prisma migrate dev` — author a new migration                |
| `db:deploy`   | `prisma migrate deploy` — apply existing migrations          |
| `db:reset`    | Drop, recreate and re-apply every migration                  |
| `db:studio`   | Prisma Studio                                                |
| `build`       | `prisma generate && tsc` — required before `apps/api` builds |

## Rules

**Never run `prisma db push` against `rasi_dev`.** Migrations only, from `0001`. `db push` writes schema changes without recording a migration, which leaves the database ahead of `prisma/migrations`; the next `migrate dev` then detects drift and offers to reset — wiping your data. There is no warning before that point.

**A migration is never edited once applied anywhere but your own machine** (coding-guidelines.md). Write a new one.

**The Better Auth models are generated, not authored.** `npx @better-auth/cli generate` writes `User`, `Session`, `Account` and `Verification` into `schema.prisma`, and that command has to stay re-runnable across upgrades. The only permitted hand-edit is **adding back-relation fields** (`staffProfile`, `notifications`, `pushSubscriptions`), which Prisma requires because the Rasi models point at `User`. Never add scalar columns to them — staff data lives in `staff_profile`.

> `authentication.md` says the generated models "must not be hand-edited". Taken literally that is impossible: without the back-relations the schema does not compile. The narrower rule above is what is actually enforceable.

**`src/generated` is not committed.** It is rebuilt by `build`.

## Constraints

Invariants are enforced by PostgreSQL, not only by the services ([coding-guidelines](../../docs/04-engineering/coding-guidelines.md#database)). Where each kind lives:

| Kind                                    | Lives in                                     | Prisma's view                      |
| --------------------------------------- | -------------------------------------------- | ---------------------------------- |
| Partial unique index                    | `schema.prisma`, `where: raw(...)`           | Managed (`partialIndexes` preview) |
| CHECK constraint                        | a `constraints_*` migration                  | Not diffed, never dropped          |
| Trigger, including deferred ones        | a `constraints_*` migration                  | Not diffed, never dropped          |
| `NULLS NOT DISTINCT` on an existing key | a `constraints_*` migration, same index name | Not diffed                         |

Rules for writing more:

- **Write the migration by hand** as a new folder, and when it adds a partial index declare it in `schema.prisma` too, copying the SQL from `prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --script`. After applying, that same command must print an empty migration.
- **Trigger functions pin `SET search_path FROM CURRENT`.** The runtime client does not set `search_path`, so a function that names a table unqualified would otherwise resolve it against the session's default.
- **Raise with plpgsql's default SQLSTATE or `check_violation`**, and start the message with the rule's name. Prisma's pg adapter turns `restrict_violation` into "Foreign key constraint violated on the (not available)" and drops the message.
- **Every constraint gets a spec** in `apps/api/test/db-constraints/` that writes straight through Prisma inside `withRollback` and asserts the constraint's name.
- **Dry-run first:** `BEGIN; \i migration.sql; ROLLBACK;` in psql catches SQL errors without leaving a half-applied migration.

## Prisma 7 notes

Three things differ from most Prisma documentation written before v7:

- **`url` is gone from the `datasource` block.** The migration connection string lives in [`prisma7.config.ts`](prisma7.config.ts), which loads `.env` via `dotenv`.
- **The runtime client takes a driver adapter**, not a connection string — `@prisma/adapter-pg`. See [`src/index.ts`](src/index.ts).
- **Every connection pins the session to UTC** (`UTC_SESSION`, exported from [`src/index.ts`](src/index.ts)) — **a new `PrismaPg` anywhere must spread it in.** The adapter sends a `DateTime` as a timestamp with no offset, so PostgreSQL reads it in the session's time zone: on a machine set to `Asia/Kolkata` every instant the application wrote was stored 5½ hours early (found 2026-09-16). The application could not see it, because reads shift back by the same amount, but `now()`, psql, pg-boss and any other reader disagreed. Business dates (`@db.Date`) were never affected — they carry no time. `apps/api/test/platform/database.spec.ts` compares an application-written instant with the database's own clock.

The client is constructed lazily, so importing `@repo/db` neither connects nor requires `DATABASE_URL` until something actually uses it. That is what lets the Better Auth CLI load `auth.config.ts` before a database exists.
