/**
 * `@repo/contracts` — the API contract, shared by both sides.
 *
 * This package may import **Zod, and nothing else**. No Prisma, no NestJS
 * (coding-guidelines.md).
 *
 * Its job is that client-side validation IS the server's validation rather
 * than a second implementation that drifts: `apps/api` validates requests
 * against these schemas, and `apps/web` feeds the same schemas to
 * react-hook-form.
 *
 * Two rules the schemas here will have to hold to, both load-bearing for money
 * correctness:
 *
 *   - **Amounts cross the API as decimal strings**, never as numbers. A JSON
 *     number is an IEEE-754 double, and the moment an amount becomes one the
 *     rounding is already wrong. Validate the string shape here; parse to
 *     Decimal at the edges.
 *   - **Business dates are plain `YYYY-MM-DD`**, distinct from instants. The
 *     only timezone conversion in the system is `toBusinessDate` in
 *     @repo/domain (BR-12).
 *
 * Phase 0 creates this package empty on purpose, so the boundary exists before
 * there is code to misplace. The ts-rest contract itself lands with the first
 * endpoints (ADR-0002).
 */

export const CONTRACTS_PACKAGE_NAME = "@repo/contracts";
