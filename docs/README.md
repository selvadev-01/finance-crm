# Rasi — Documentation

Specification set for **Rasi**, a daily-collection finance application replacing a manual Google Sheet process (1,000+ customers, 10+ collection lines, multiple sectors).

Source of truth for business intent: [`reference/Rasi_Application_Product_Documentation_v0.1.pdf`](reference/Rasi_Application_Product_Documentation_v0.1.pdf). Where this documentation set contradicts the PDF, **this set wins** — it resolves ambiguities the PDF left open. Every such resolution is recorded in [`01-product/business-rules.md`](01-product/business-rules.md).

## Reading order

New to the project? Read in this order:

1. [`00-overview/vision.md`](00-overview/vision.md) — what Rasi is and why it exists
2. [`00-overview/glossary.md`](00-overview/glossary.md) — **read before anything else**; the domain vocabulary is specific and easy to get wrong
3. [`00-overview/personas.md`](00-overview/personas.md) — the four roles and their working conditions
4. [`01-product/business-rules.md`](01-product/business-rules.md) — the money rules, with worked examples
5. [`03-data/erd.md`](03-data/erd.md) — the data model
6. [`04-engineering/coding-guidelines.md`](04-engineering/coding-guidelines.md) — the five non-negotiables before writing code
7. [`04-engineering/project-structure.md`](04-engineering/project-structure.md) — what is actually in the repository today, and what is not

## Structure

| Folder             | Contents                                                                                 |
| ------------------ | ---------------------------------------------------------------------------------------- |
| `00-overview/`     | Vision, glossary, personas                                                               |
| `01-product/`      | PRD, per-module specs, user stories, business rules, RBAC matrix                         |
| `02-architecture/` | System architecture, ADRs, API design, auth, jobs, notifications, offline sync, security |
| `03-data/`         | ERD, data dictionary                                                                     |
| `04-engineering/`  | Project structure, coding guidelines, definition of done                                 |
| `05-ux/`           | Design system, screen specifications, navigation/IA                                      |
| `06-delivery/`     | Roadmap, backlog                                                                         |
| `reference/`       | Original source documents                                                                |

## Status

### Specification

| Stage                     | State                                                                         |
| ------------------------- | ----------------------------------------------------------------------------- |
| Overview + business rules | **Complete** — three ambiguities resolved (BR-08, BR-01a, BR-16a)             |
| Data model                | **Complete**                                                                  |
| Product specs             | **Complete** — PRD, 16 module specs, 97 stories, RBAC matrix                  |
| Architecture              | **Complete** — C4, 10 ADRs, auth, API, jobs, notifications, offline, security |
| Engineering guidelines    | **Complete** — project structure, coding guidelines, DoD                      |
| UX specs                  | **Complete** — navigation, design system, 7 screens in full, 23 listed        |
| Delivery plan             | **Complete** — 6 build phases, ~16 weeks                                      |

> Five open questions remain in [`01-product/business-rules.md`](01-product/business-rules.md#open-questions), each with a proposed answer that stands unless overridden — none blocks implementation.

### Implementation

**Phase 0 complete. No product modules built.** The foundations are in place and verified; M01–M16 are untouched.

| Foundation                                                           | State                     |
| -------------------------------------------------------------------- | ------------------------- |
| Turborepo + pnpm workspace                                           | **Done**                  |
| Shared eslint / tsconfig packages                                    | **Done**                  |
| `apps/web`, `apps/api` booting                                       | **Done**                  |
| Lint, type-check, test, format scripts                               | **Done**                  |
| PostgreSQL 17 — `rasi_dev`, `public` + `test` schemas                | **Done**                  |
| `packages/db` — Prisma 7, 28 tables, 2 migrations                    | **Done**                  |
| Better Auth, mounted and signing users in                            | **Done**                  |
| `packages/domain`, `packages/contracts` — empty, boundaries enforced | **Done**                  |
| `@repo/ui` — Tailwind v4 tokens and component base                   | **Done**                  |
| Test harness — two-tier isolation                                    | **Done**                  |
| `packages/notifications`                                             | **Not started** — Phase 4 |
| M01–M16                                                              | **Not started**           |

This table is a phase-level summary, refreshed at phase boundaries. **Per-story status lives in [`06-delivery/backlog.md`](06-delivery/backlog.md)** and nowhere else — check there before assuming anything is built. Repository detail, with versions and the exact gap list, is in [`04-engineering/project-structure.md`](04-engineering/project-structure.md).

## Scope boundaries

**No deployment or hosting plan.** Deferred by decision until the application is built. Everything runs on one machine, PostgreSQL installed natively, **no Docker**.

**No data import.** There is no exportable dataset behind the current spreadsheet, so none is built. Development runs on seeded data, and real customers are onboarded by hand through the standard flow.

## Where the risk is

**Offline sync** ([offline-sync.md](02-architecture/offline-sync.md)) is the highest technical risk in the project, by a distance. A Junior who cannot record a collection at a customer's door has no fallback but paper — which is the system Rasi exists to replace. It cannot be retrofitted: it shapes the schema, the API and the day-close model.

**Launch-day data entry** is the largest non-engineering task. 1,000+ customers typed in by hand, each already mid-account. That is why the onboarding and account-creation forms are treated as throughput-critical, and why [release gate 6](01-product/prd.md#release-gates) exists — an account created on day 47 must behave exactly like one created on day 1.

## Conventions

- All monetary examples use the figures from the source PDF: ₹10,000 account / ₹8,500 invested / ₹1,500 profit / ₹100 per day.
- Diagrams are Mermaid, rendered inline by VS Code's Markdown preview.
- Package names are `@repo/*`, matching the workspace as it exists.
- Rules are identified as `BR-nn` and referenced by ID from other documents.
