# ADR-0010 — Tailwind v4 and an owned component base

**Status:** Accepted · **Date:** 2026-09-13

## Context

The backlog carried "Tailwind preset + component base in `@repo/ui`" as a single row with no specification behind it. Tailwind appeared twice in the whole documentation set and shadcn/ui once, as a note that neither existed. There was no design-system document, no token set, no named component inventory — [`docs/05-ux/`](../../05-ux/) held only `navigation-ia.md` and `screen-specs.md`.

So this was not a decision to look up. It had to be made.

What the specs _do_ constrain is real, and it shapes the answer: 360px is the design target for the Junior's field app, which runs one-handed on a mid-range Android, outdoors, sometimes gloved, often with no signal. The admin console is the opposite — dense tables where information density is a feature. One package serves both.

## Decision

**Tailwind v4, with shadcn/ui available as a source of components we own.**

**Tokens live in `packages/ui/src/theme.css` as a `@theme` block.** Tailwind v4 removes the `presets` mechanism that [system-architecture.md](../system-architecture.md) assumed, so the shared layer is CSS, not a JavaScript config object. An app imports that one file.

**Two density modes, driven by CSS variables**, not by props: `data-density="comfortable"` gives a 44px minimum touch target for the field app, `compact` gives a 36px control for the console. Components read `--control-height` and never take a `dense` boolean.

**Component APIs follow explicit variants over boolean props.** `tone="danger"` rather than `<Button primary danger>`, which is representable and meaningless. The three empty states the screen specs demand — _nothing yet_, _no matches_, _not permitted_ — are three components, not one with a `variant` prop, because they call for three different user actions and one of them is "none".

**Icons come from `@phosphor-icons/react`, one family, `strokeWidth` 1.5.** `shadcn init` defaults to `lucide-react`; since we are adding shadcn fresh rather than inheriting it, the non-default is chosen at the start. Retrofitting an icon family across a built component base is pure churn.

## Alternatives considered

**Tailwind v3**, which would match the word "preset" in the existing architecture doc literally. Rejected: it starts a greenfield foundation one major version behind, and the doc sentence is cheaper to correct than the version is to upgrade later.

**A full third-party component library** — Material, Carbon, Fluent. Each brings a complete design language and accessibility work already done, which is genuinely attractive. Rejected because the Junior's field app is not a generic admin surface: it is a single-purpose, glove-operable, offline-first screen, and fighting an opinionated library's spacing and interaction model there costs more than it saves. Carbon in particular is built for exactly the dense-table half of this product and none of the other half.

**Hand-building every primitive with no library at all.** Smallest bundle, which matters for the Junior. Rejected because it means hand-writing a dialog, combobox and date picker with correct focus management and ARIA — work that is easy to get subtly wrong and that shadcn has already done, in code we own outright rather than depend on.

## Consequences

The `@theme` file is the single source of colour, type, radius and elevation. A component that hard-codes a hex value is a review comment.

**`@repo/ui` uses Bundler module resolution while `@repo/db` and `@repo/domain` use NodeNext.** That asymmetry is deliberate and must not be "aligned": resolution mode has to match the consumer, and `@repo/ui` is consumed only by a bundler while the others are compiled and run by Node. Under NodeNext `@repo/ui`'s relative imports would need `.js` specifiers, which Turbopack cannot resolve to `.tsx`.

**`theme.css` carries an `@source "../../ui/src"` directive, and it is load-bearing.** Tailwind scans only the importing project by default, and `@repo/ui` ships raw TSX from outside `apps/web`. Without it every class used by a `@repo/ui` component is purged from the production build and components render unstyled — which reads as a component bug rather than a configuration one. The design-preview route at `/` exists partly so that failure is immediately visible.

**No dark mode yet.** Both surfaces are daylight tools and neither persona asked for one. The tokens are structured so adding it is a second `@theme` block rather than a rewrite, but shipping a half-built dark mode would be worse than none.

**No webfont.** The type stack is system fonts, because a render-blocking font request buys nothing a collector notices on a poor connection, and the Geist files the scaffold shipped were create-next-app leftovers rather than a brand decision.

## Skills

Four skills were nominated for this work and they are **not** interchangeable, so the roles are recorded here rather than left to inference:

| Skill                         | Role                                                                         |
| ----------------------------- | ---------------------------------------------------------------------------- |
| `ecc:design-system`           | Primary. Token generation, and the audit and slop-check that gate a UI story |
| `vercel-composition-patterns` | Component API design in `@repo/ui`                                           |
| `vercel-react-best-practices` | `apps/web` — server components, bundle, Core Web Vitals                      |
| `design-taste-frontend`       | Anti-slop review checklist only                                              |

`design-taste-frontend` rules itself out for "dashboards, data tables, multi-step product UI" in its own §13, and Rasi is almost entirely those. Its landing-page machinery — the dial system, hero composition, eyebrow budgets, marquees, scroll choreography — **does not apply** to Rasi's product surfaces. What does transfer is its review half: the AI-tells list, the em-dash ban, the colour and shape consistency locks, button and form contrast checks, full loading/empty/error state cycles, reduced-motion handling, and no hand-rolled SVG icons. Its §2.A independently recommends shadcn/ui for "modern SaaS where you own the components", which corroborates the choice above.
