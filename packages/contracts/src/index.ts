/**
 * `@repo/contracts` — the API contract, shared by both sides (ADR-0011).
 *
 * This package may import **Zod, and nothing else**. No Prisma, no NestJS
 * (coding-guidelines.md).
 *
 * Its job is that client-side validation IS the server's validation rather
 * than a second implementation that drifts: `apps/api` validates requests
 * against these schemas and shapes its responses with them, and `apps/web`
 * feeds the same schemas to react-hook-form.
 *
 * Two rules the schemas hold to, both load-bearing for money correctness:
 *
 *   - **Amounts cross the API as decimal strings**, never as numbers. A JSON
 *     number is an IEEE-754 double, and the moment an amount becomes one the
 *     rounding is already wrong.
 *   - **Business dates are plain `YYYY-MM-DD`**, distinct from instants. The
 *     only timezone conversion in the system is `toBusinessDate` in
 *     @repo/domain (BR-12).
 */
export * from "./client.js";
export * from "./customer.contract.js";
export * from "./organisation.contract.js";
export * from "./route.js";
export * from "./shared.js";
export * from "./staff.contract.js";
