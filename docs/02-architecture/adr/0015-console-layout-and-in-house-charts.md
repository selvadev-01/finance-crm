# ADR-0015 — Console layout on the "Lavish" structure, and in-house charts

**Status:** Accepted · **Date:** 2026-09-19 · **Revises:** [ADR-0013](0013-console-re-theme-and-headless-libraries.md), for the shell and the dashboards only

## Context

The owner asked for the console sidebar and the dashboards to be redesigned after the "Lavish" admin template. That is a Bootstrap theme with these features:

- a tinted sidebar whose current item is a tab joined to the page;
- a pinnable icon rail;
- a glass top bar;
- borderless cards on a tinted page;
- KPI tiles with change chips;
- radial rings;
- an area chart of sales over time.

Two things stood in the way.

**The look conflicted with ADR-0013.** ADR-0013 lets borders do the separating, uses shadows only for what floats, and allows the pill radius only on dots and counts. The Lavish structure depends on flat tiles and soft pills.

**The chart had no data behind it.** The dashboards had no time series and the web app had no chart library. Every obvious library, Recharts included, needs each amount as a JavaScript `number`. Non-negotiable 1 forbids exactly that: no floating point in the money path, including the frontend.

## Decision

**Take Lavish's structure, keep ADR-0013's palette.** The owner chose this explicitly. The console keeps its soft-teal tokens, and nothing is recoloured, including the field app. What changes:

- **Sidebar.**
  - It sits on a new `surface-nav` layer, one step below the page.
  - The current item's row is drawn in `surface`, the page's own colour.
  - Two pseudo-element circles in `surface-nav`, shadowed with `surface`, draw the inverted corners, so the tab reads as part of the page.
  - Items lead with 36px icon tiles (`radius-tile`).
  - From 1280px the sidebar can be pinned to a 70px rail. The choice is remembered per browser, with an in-memory fallback when storage is refused.
  - The rail opens over the page while the pointer or keyboard focus is in it.
- **Top bar.** Glass (translucent `surface` with a backdrop blur), falling back to solid where the browser cannot blur. Round icon actions carry a count.
- **Dashboards.**
  - Figures sit on flat white tiles and cards on the tinted page: `StatGrid frame="tiles"`, `Card surface="flat"`, `DataView frame="flat"`. They use a hairline ring rather than a border and shadow, because white on a 98% page needs an edge.
  - Status on a card is a soft pill (`Badge shape="pill"`).
  - Headline shares are `RadialMeter` rings in the header.
  - Tables and forms elsewhere in the console keep ADR-0013's outlined surfaces.
- **The variants reach their parts through `data-*` groups, not React context.** `layout.tsx` is imported by Server Components, where `createContext` is unavailable.

**Charts are drawn in-house, as SVG.**

- `AreaChart` in `@repo/ui` draws the series.
- `chart-scale.ts` is the only place a money string meets a number, and only as a fraction of the plot's height:
  - parsing, the axis ceiling and the tick values stay in BigInt paise;
  - labels and the tooltip format the original decimal strings with `formatCurrency`.
- The chart is an image with a summary, a hidden table of every point, and a keyboard cursor.
- The rule "never hand-roll an SVG path" is about icons. It does not cover charts.

**The trend is a new read over existing figures.**

- `GET /api/dashboards/trend` sums `lineDailyFigures` over the caller's scoped lines. That is the per-day grain `lineRangeFigures` already read, and the day close's own predicates.
- It uses the existing `money.lineTotals` permission, so no RBAC cell changes.

## Alternatives considered

**Recharts or another library.** Rejected. It would put every amount through `Number()`, it styles through props rather than tokens, and one two-series chart does not justify its bundle.

**The full Lavish palette** (blue accent, blue-grey surfaces). Offered and declined by the owner. It would need a second contrast audit and a sunlight check of the field app.

**A second KPI component beside `Stat`.** Rejected. ADR-0013 collapsed seven local stat cards into one, and a frame variant keeps it one.

## Consequences

- `theme.test.ts` holds `ink`, `ink-muted` and `ink-subtle` on `surface-nav` to 4.5:1.
- The rail no longer shows tooltips. Its labels stay in the accessibility tree, and the peek shows them visually.
- A future chart reuses `AreaChart` and `chart-scale.ts`. A new chart kind extends them, and does not reach for a library without superseding this ADR.
- S-07's "Sectors today" became cards. The figures are unchanged, but the list is no longer sortable. `/dashboard/sectors` remains the sortable comparison.
