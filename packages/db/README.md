# `@repo/db`

Prisma schema, migrations and the client. **Sole owner of the database schema** — no other package defines tables.

## Local setup

PostgreSQL is installed natively, no Docker. **One database, two schemas:**

| Schema   | Used by                         | Notes                                        |
| -------- | ------------------------------- | -------------------------------------------- |
| `public` | `pnpm dev`, your data, the seed | `DATABASE_URL`                               |
| `test`   | the test harness only           | `TEST_DATABASE_URL`, truncated between tests |

One-time creation, as a superuser:

```sql
CREATE ROLE rasi WITH LOGIN CREATEDB PASSWORD '...';
CREATE DATABASE rasi_dev OWNER rasi;
\c rasi_dev
CREATE SCHEMA test AUTHORIZATION rasi;
```

`CREATEDB` is required: `prisma migrate dev` creates and drops a shadow database to diff migrations against.

Then copy `.env.example` to `.env` at the repository root and fill in the password. Both URLs point at `rasi_dev` and differ only by `?schema=`.

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

## Prisma 7 notes

Two things differ from most Prisma documentation written before v7:

- **`url` is gone from the `datasource` block.** The migration connection string lives in [`prisma7.config.ts`](prisma7.config.ts), which loads `.env` via `dotenv`.
- **The runtime client takes a driver adapter**, not a connection string — `@prisma/adapter-pg`. See [`src/index.ts`](src/index.ts).

The client is constructed lazily, so importing `@repo/db` neither connects nor requires `DATABASE_URL` until something actually uses it. That is what lets the Better Auth CLI load `auth.config.ts` before a database exists.
