/**
 * `@repo/domain` — the money maths, deliberately framework-free.
 *
 * This package may import **decimal.js and date utilities, and nothing else**.
 * No Prisma, no NestJS, no Zod, no application code (coding-guidelines.md).
 *
 * That constraint is what makes working-day arithmetic, schedule generation,
 * variance classification and profit apportionment exhaustively testable in
 * milliseconds, with no database and no application context. It does not come
 * back once broken, because the next contributor follows the precedent.
 *
 * Enforcement is in two layers, strongest first:
 *
 *   1. This package's `dependencies` list. pnpm's isolated node_modules means
 *      an import of anything not listed there simply does not resolve — a hard
 *      compile error with no rule to configure and no comment that silences it.
 *   2. `no-restricted-imports` in @repo/eslint-config/boundaries, which catches
 *      what dependency hygiene cannot: deep paths, re-exports and transitive
 *      leakage.
 *
 * Phase 0 creates this package empty on purpose, so the boundary exists before
 * there is code to misplace. The contents arrive in Phase 1, starting with the
 * working calendar (M06) — the single highest-leverage piece in the schedule,
 * because an off-by-one in working-day counting produces no error, just wrong
 * completion dates discovered weeks later.
 */

export const DOMAIN_PACKAGE_NAME = "@repo/domain";
