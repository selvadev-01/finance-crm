# Design system

Tokens, density, and the component base in [`@repo/ui`](../../packages/ui). The stack was decided in [ADR-0010](../02-architecture/adr/0010-tailwind-v4-component-base.md), and the current look and library choices in [ADR-0013](../02-architecture/adr/0013-console-re-theme-and-headless-libraries.md). This document is what to follow when building a screen.

Everything below is built. For what is still to be checked, see the backlog row "Console UI overhaul".

Source of truth is [`packages/ui/src/theme.css`](../../packages/ui/src/theme.css). If this document and that file disagree, the file is right and this one is stale.

---

## The constraint that shapes everything

Rasi is two products in one package.

|            | Junior field app                                 | Admin console                              |
| ---------- | ------------------------------------------------ | ------------------------------------------ |
| Device     | Mid-range Android, 360px                         | Desktop, 1280px+                           |
| Conditions | Outdoors, sunlight, one-handed, sometimes gloved | Seated, mouse and keyboard                 |
| Network    | Unreliable or absent                             | Reliable                                   |
| Goal       | Record one collection, fast, without error       | Scan hundreds of rows, compare, drill down |
| Chrome     | None at all — no sidebar, no tab bar             | Sidebar, filters, bulk actions             |

A component that assumes one of these is wrong for the other. That is what the density modes exist to resolve.

---

## Density

Two modes, set with a `data-density` attribute on a layout element. Components read CSS variables and never take a `dense` prop.

| Variable              | `comfortable` (default) | `compact`                         |
| --------------------- | ----------------------- | --------------------------------- |
| `--control-height`    | `2.75rem` (44px)        | `2.25rem` (36px)                  |
| `--control-height-sm` | `2.25rem`               | `1.75rem` — toolbars, row actions |
| `--control-padding-x` | `1rem`                  | `0.75rem`                         |
| `--control-font-size` | `1rem`                  | `0.875rem`, `1rem` below 768px    |
| `--cell-padding-x`    | `1rem`                  | `0.875rem`                        |
| `--row-padding-y`     | `0.875rem`              | `0.625rem`                        |
| `--field-gap`         | `0.375rem`              | `0.375rem` — label to control     |
| `--stack-gap`         | `1rem`                  | `0.75rem`                         |
| `--section-gap`       | `2rem`                  | `1.75rem`                         |
| `--page-padding`      | `1rem`                  | `1rem`, `2rem` from 768px         |
| `--header-height`     | `3.5rem`                | `3.25rem`                         |

`size="sm"` on a `Button` reads `--control-height-sm`. It is for the console only, never for anything a Junior taps.

`--control-font-size` sets the text size in controls: `Button`, `Input` and `Select`. The console's controls match its 14px body text. Below 768px they go back to 16px, because a Senior uses the console on a phone and iOS zooms the page when an input under 16px gets focus. Write it as `text-[length:var(--control-font-size)]`: without the `length:` hint, Tailwind reads a bare variable as a colour.

The root layout sets `compact` because the console is the larger surface. The Junior's route segment sets `comfortable` on its own layout, and every control inside widens with no component change.

**44px is a floor, not a target, for anything the Junior taps.** It is the number that survives a gloved thumb.

---

## Colour

**"Soft teal": calm and fresh** (revised 2026-09-17 from the first "ledger" navy-on-paper palette, which read as too heavy). People spend a whole working day on these screens.

- **Neutrals:** a light mint-grey carrying a trace of the accent's hue.
- **Text:** a deep slate.
- **Accent:** a single teal, used for the primary action and the current place only.

| Role    | Token                                                                                   | Used for                                                          |
| ------- | --------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| Surface | `surface`, `surface-raised`, `surface-sunken`, `surface-overlay`, `surface-nav`         | Page, cards, wells and table heads, popovers, the console sidebar |
| Line    | `border` (dividers), `border-strong` (control outlines, 3:1 on white)                   | Rules and inputs                                                  |
| Text    | `ink`, `ink-muted`, `ink-subtle`, `ink-inverse`                                         | Four levels, no more; all ≥ 4.5:1                                 |
| Accent  | `accent`, `accent-hover`, `accent-subtle`, `accent-ink`                                 | Primary action, current nav item, links                           |
| Status  | `positive`, `warning`, `critical`, `info`, each with `-subtle`, `-border` and `-bright` | Classification, sync state, discrepancies                         |

Each status tone has four roles:

| Role      | Use                                                                                               | Held to                     |
| --------- | ------------------------------------------------------------------------------------------------- | --------------------------- |
| bare      | Text on white or on its `-subtle`; a solid fill under `ink-inverse` (danger button, unread count) | 4.5:1 in all three pairings |
| `-subtle` | Tinted background of a badge or message                                                           | —                           |
| `-border` | Outline of that tinted background                                                                 | —                           |
| `-bright` | A dot or indicator with no text beside it                                                         | 3:1 on white                |

**Status colour is reserved for status.** An accent button is not `positive` because the action is good; positive means a collection reconciled. No status hue is close to the accent, so a status is never mistaken for the button colour:

- positive is a yellow-green, well away from teal;
- critical is a coral rather than a hard red;
- info is violet.

**Contrast is tested, not measured by hand.** `packages/ui/src/theme.test.ts` checks every pairing above. The three failures measured on 2026-09-14 are gone, and a badge never needs its text darkened. Status colours must also stay distinguishable from each other **in sunlight on a mid-range screen**, which is a stricter test than a contrast ratio. Check `/route` outdoors after changing one.

No dark mode yet, deliberately (ADR-0013). The tokens are named by role so it can be a second `@theme` block later. Do not use `dark:` utilities.

---

## Type

**IBM Plex Sans and IBM Plex Mono** in the console and on the sign-in screens. They are self-hosted by `next/font` in the root layout as `--font-plex` and `--font-plex-mono`, with `preload: false`, so a file is fetched only when text on the page uses it. The `latin-ext` subset carries ₹. A browser check on 2026-09-16 confirmed the glyph comes from Plex. Tamil-script names fall back to the system font.

**The Junior's field app uses the system font.** `app/route/layout.tsx` sets `data-font="system"`, which redeclares `--font-sans` and `--font-mono` for its subtree. It never downloads Plex: a font request buys nothing a collector notices on a poor connection. Resetting `--font-plex` alone would not work, because the stacks are resolved at the root.

Use the **role sizes**, not Tailwind's numeric scale, in the console:

| Utility        | Size / line height | Weight | For                                |
| -------------- | ------------------ | ------ | ---------------------------------- |
| `text-display` | 26 / 34px          | 600    | The page title (`PageHeader`)      |
| `text-title`   | 19 / 26px          | 600    | A record's name in a card or panel |
| `text-heading` | 15 / 22px          | 600    | Section and dialog headings        |
| `text-body`    | 14 / 20px          | 400    | Table cells, paragraphs            |
| `text-label`   | 13 / 18px          | 500    | Field labels, small buttons        |
| `text-caption` | 12 / 16px          | 400    | Hints, "asked by …", metadata      |
| `text-2xs`     | 11 / 16px          | —      | Column headers and badges only     |

The field app keeps Tailwind's `text-sm`/`text-base`, sized for a phone.

`font-variant-numeric: tabular-nums` applies to tables and anything marked `data-numeric`. Money is compared down a column constantly, and proportional digits make that harder for no benefit.

---

## Shape, elevation, motion

Gently rounded: friendly, but still tidy in a dense table. Use the utilities Tailwind generates from the tokens, never `rounded-[var(--radius-…)]`:

| Utility           | Radius | For                                                                                                |
| ----------------- | ------ | -------------------------------------------------------------------------------------------------- |
| `rounded-control` | 8px    | Buttons, inputs, badges                                                                            |
| `rounded-surface` | 12px   | Cards, tables                                                                                      |
| `rounded-overlay` | 16px   | Dialogs, popovers                                                                                  |
| `rounded-pill`    | full   | Status dots and counts; on dashboards, status pills, delta chips and round icon actions (ADR-0015) |
| `rounded-tile`    | 10px   | Icon tiles: the sidebar's 36px tiles, the dashboards' tinted icon squares                          |
| `rounded-nav`     | 16px   | The current sidebar item's tab, where it joins the page                                            |

**Dashboards are the exception to the next paragraph** ([ADR-0015](../02-architecture/adr/0015-console-layout-and-in-house-charts.md)). There, figures sit on flat white tiles and cards on the tinted page, with a hairline ring (`flatSurfaceClass`) rather than a border and shadow: `StatGrid frame="tiles"`, `Card surface="flat"` and `DataView frame="flat"`. Everywhere else, the rule below holds.

Borders do most of the separating. `shadow-raised` is a hairline under a card or a button. `shadow-popover` and `shadow-overlay` are for things that float. Shadows are tinted with the ink hue, never pure black. Cards are used only where a boundary communicates real hierarchy; otherwise group with a rule or with space.

Focus is **always visible**. There is a 2px accent outline with a 2px offset, applied globally. Text controls instead show an accent border and a soft ring on any focus, including a click, because a person needs to see where the caret went. Never remove focus without replacing it with something at least as clear.

Motion is minimal and functional: a colour transition on hover, a 1px translate on press so a gloved tap registers visibly, and a 120ms fade-in (`animate-in`) for dialogs. Anything more must justify itself as hierarchy, feedback, or state change.

---

## Component base

What exists today. The inventory grows with the screens, not ahead of them.

| Component                                   | Notes                                                                                                                                                                                                                                                                                                |
| ------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Button`                                    | `tone`: `primary` · `secondary` · `ghost` · `danger` · `link`. `size`: `default` · `sm`. Defaults to `type="button"`                                                                                                                                                                                 |
| `Badge`                                     | `tone`: `neutral` · `positive` · `warning` · `critical` · `info`. Toned badges carry a `-bright` dot (`mark="none"` when the badge brings its own icon); text needs no override. `shape`: `tag` (default) · `pill`, the soft outline-less pill on a dashboard card                                   |
| `NothingYet` / `NoMatches` / `NotPermitted` | Three empty states, three components                                                                                                                                                                                                                                                                 |
| `Input`                                     | Native input at the density control height; `aria-invalid` turns the border critical                                                                                                                                                                                                                 |
| `Field`                                     | Label, hint and error around one control; wires `id`, `aria-describedby`, `aria-invalid`. An error replaces the hint                                                                                                                                                                                 |
| `FormMessage`                               | `tone`: `critical` (`role="alert"`) · `warning` · `info` (`role="status"`), and an optional `action` ("Save anyway"). Form-level messages, not field errors                                                                                                                                          |
| `Select`                                    | Native `<select>` on the control scale, styled to match `Input`                                                                                                                                                                                                                                      |
| `Textarea`                                  | Multi-line text on `Input`'s frame, at least two control heights tall                                                                                                                                                                                                                                |
| `Dialog` / `DialogActions`                  | Native `<dialog>` with `showModal()`: focus trap, Escape and inert background come from the platform. Controlled; every dismissal goes through `onClose`, so a pending request can refuse it. `size`: `sm` · `md` · `lg`. `DialogActions` is a ruled footer band and must be the dialog's last child |
| `PageHeader`                                | `title`, `trail` (breadcrumbs), `meta` (code and status line), `description`, `actions`. `eyebrow` is a deprecated alias of `trail`. `frame`: `ruled` (default) · `hero`, a dashboard's unruled header, whose `summary` slot holds `RadialMeter`s from 768px                                         |
| `buttonClass(tone)`                         | The button look for a `Link`, so a button never wraps an anchor                                                                                                                                                                                                                                      |
| `formatCurrency`                            | Decimal string in, `₹1,23,456.00` out                                                                                                                                                                                                                                                                |
| `formatBusinessDate`                        | `YYYY-MM-DD` in, `13 Sep 2026` out                                                                                                                                                                                                                                                                   |
| `cn`                                        | Class merge where later Tailwind utilities win                                                                                                                                                                                                                                                       |

### Interactive building blocks (Radix, ADR-0013)

| Component                                        | Notes                                                                                                                                                                                                  |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `Checkbox`, `Switch`                             | Controlled with `checked` / `onCheckedChange`. `Checkbox` for a choice saved with a form; `Switch` for a setting that applies at once                                                                  |
| `Choice`                                         | The label (and optional description) beside one `Checkbox` or `Switch`: the sideways sibling of `Field`                                                                                                |
| `Combobox`                                       | A searchable single choice: `options` (`value`, `label`, `hint`), `value`, `onValueChange`. Searches labels and hints only, never the value. Works inside `Field`. For a short fixed list use `Select` |
| `Tabs.Root/List/Trigger/Content`                 | The parts of one record (S-09). Control `value` from the screen so it can live in `?tab=`. Not for page navigation                                                                                     |
| `Popover.Root/Trigger/Content`                   | A non-modal floating panel                                                                                                                                                                             |
| `Menu.Root/Trigger/Content/Item/Label/Separator` | Row and account actions. `Item tone="danger"` for a destructive one, which still confirms in a `Dialog`                                                                                                |
| `Tooltip`                                        | A label for an icon-only control. Never the only place information lives, since touch has no hover                                                                                                     |
| `toast()` / `Toaster`                            | Confirms something that happened out of sight ("Line LN-07 created"). `Toaster` is mounted once in the console layout. Errors a person must act on stay on the form                                    |
| `Slot`                                           | Radix `Slot`, so a component can take `asChild` (a Next `Link`) without `@repo/ui` importing Next                                                                                                      |

**Floating layers inside a `Dialog` mount inside it.** A native modal dialog is in the top layer and makes everything outside it inert, so a list portalled to `<body>` would sit behind the backdrop. `Dialog` provides its element through `PortalContainerContext`, and `Popover`, `Menu`, `Combobox` and `Tooltip` mount there. Escape closes the innermost layer first: Radix prevents the key's default, so the dialog does not also close. This was checked in Chrome on 2026-09-16. Toasts still render at `<body>`: raise them after a dialog closes.

### Page building blocks

| Component                                                                 | Notes                                                                                                                                                                                                                                                                                                                                            |
| ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `AppShell.Root/Sidebar/Drawer/NavSection/NavItem/Body/Topbar/Main`        | The console frame (ADR-0015). The sidebar sits on `surface-nav`, and the current `NavItem` is a tab joined to the page. `NavItem` takes the link as its child (`<Link href="…" />`) and `state="current"` or `"idle"`. The rail opens over the page on hover or keyboard focus; it has no tooltips. `Main width="wide"` is for many-column lists |
| `AppShell.SidebarToggle`, `useSidebarMode()`                              | From 1280px, pins the sidebar to the rail (`"expanded"` · `"rail"`), remembered per browser with a memory fallback                                                                                                                                                                                                                               |
| `AppShell.TopbarAction`, `AppShell.RailLabel`                             | A round icon action in the glass top bar, with a required `label` and an optional `count`; text in the brand that shows only while the sidebar is wide                                                                                                                                                                                           |
| `Section`                                                                 | A titled part of a page: `title`, `description`, `actions`, `as="h3"` inside a tab or card. The heading labels the region                                                                                                                                                                                                                        |
| `Card.Root/Header/Body/Footer`                                            | A bordered panel. Use it only where the boundary means something. `surface="flat"` on a dashboard                                                                                                                                                                                                                                                |
| `StatGrid` + `Stat`                                                       | Figures in one ruled frame (`columns` 2, 3 or 4). `Stat tone` colours the figure only when it is itself a status (a shortfall). The caller formats money. `frame="tiles"` makes each figure a flat tile with an `icon` (`iconTone`) and an optional `delta` (`DeltaChip`)                                                                        |
| `Meter`, `RadialMeter`                                                    | A share as a bar or a ring. `value` is per-mille (883 is 88.3%), worked out by the caller in exact paise; `valueText` is what is read aloud. `tone`: `accent` · `positive` · `warning` · `critical`                                                                                                                                              |
| `DeltaChip`                                                               | A change since the day before: `direction` (`up` · `down` · `flat`) and, separately, `tone` (whether that is good news)                                                                                                                                                                                                                          |
| `ActivityList.Root/Item/Icon/Body/Aside`, `HealthCard.Root/Header/Detail` | A list led by 56px tinted icon squares ("Needs attention"); a small flat card for one thing's state, with a pill and a meter                                                                                                                                                                                                                     |
| `AreaChart`                                                               | A money series over days, hand-drawn SVG. Values are decimal strings and become plot fractions only in `chart-scale.ts`, the one place in the UI a money string meets a number. It is an image with a summary, a hidden table of every point, and ←/→ to read one day at a time                                                                  |
| `DescriptionList` + `Description`                                         | A record's fields (`layout` `rows` or `columns`). A missing value shows "—"                                                                                                                                                                                                                                                                      |
| `RecordIdentity`, `recordLinkClass`, `rowLinkClass`                       | A row's identity: the name (often a link) with its code under it. In a `DataView`, `rowLinkClass` plus `data-row-link` stretches the name's link over the whole row; other controls in the row stay clickable above it                                                                                                                           |
| `Breadcrumbs`                                                             | The rollup chain. Each child is a step; the app's `PageTrail` builds it from `{label, href}`                                                                                                                                                                                                                                                     |
| `Skeleton`, `DetailSkeleton`, `ListSkeleton`                              | Loading states in the page's own shape                                                                                                                                                                                                                                                                                                           |

### Lists

| Component                   | Notes                                                                                                                                                                                                                                           |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `DataView`                  | TanStack Table 8, shown as a table from 768px and as cards below. Columns are TanStack `ColumnDef`s with `meta.align` and `meta.hideOnCard`. **Sorting is offered only when `complete`**: sorting the first page of a longer list would mislead |
| `DataView footer`           | A `ListFooter` passed as `footer` becomes the bottom band inside the table frame (below the cards on a phone), as in the Stitch designs                                                                                                         |
| `CodeChip`                  | A short code in a quiet mono chip beside a name: `LN-07` Market Road                                                                                                                                                                            |
| `FilterBar` + `FilterField` | The controls above a list, in a light framed panel: labelled, `width` `sm`, `md` or `lg`, full width on a phone                                                                                                                                 |
| `ListFooter`                | "N items" plus "Show more", which follows the API cursor                                                                                                                                                                                        |
| `EmptyFrame`                | The frame an empty state sits in, matching the table's                                                                                                                                                                                          |

In `apps/web`, a list is built from:

- `usePagedQuery` (cursor pages);
- `useListState` (filters in the URL);
- the column builders in `components/columns.tsx` (`identityColumn`, `moneyColumn` sorted in paise, `valueColumn`, `displayColumn`);
- `ListFallback` for loading, failed, not-permitted and the screen's chosen empty state.

`sectors/sector-list.tsx` is the reference list page, and `sectors/[sectorId]/sector-detail.tsx` the reference detail page.

### Forms

react-hook-form 7.88 over the contract's own zod schema (`@hookform/resolvers` 5.9, zod 4.6.2), so the browser checks exactly what the API will check.

| Component                     | Notes                                                                                                                                                                                                                                                   |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `useZodForm(schema, options)` | The form, in `mode: "onTouched"`: an error shows when the field is left, then tracks typing. On submit, the first invalid field takes focus                                                                                                             |
| `Form`                        | The `<form>`, with the browser's own validation off                                                                                                                                                                                                     |
| `FormField`                   | Label, one text-like control (registered, so it does not re-render on every keystroke), and its hint or error. Takes nested names (`references.0.mobile`). `valueAs="trimmed"` or `"optional"` (empty means absent); `rewrite` rewords a schema message |
| `FormControlField`            | The same for a `Combobox`, `Checkbox` or `Switch`, through a render function. This is the one sanctioned render prop                                                                                                                                    |
| `FormRootError`               | The form-level message from `root.server`. A `warning` type shows amber                                                                                                                                                                                 |
| `FormActions`, `SubmitButton` | The action row, and a submit button that disables itself and shows its pending label                                                                                                                                                                    |
| `DialogForm`                  | A dialog whose body is a form. It refuses to close mid-write and draws its own Cancel and submit buttons                                                                                                                                                |

**Error wording** goes through one rule, used for both the browser's checks and the API's `400` details (`fieldMessage`, `validationMessage`):

- A message written to follow the label reads "Code is already in use."
- A standalone message reads "A reason is required."
- An empty field always reads "{Label} is required."
- zod's developer phrasing becomes "Check {label}."

In `apps/web`, `applyWriteFailure(form.setError, result, { fields })` puts a failed `apiWrite` on the form. Each detail whose field the form shows lands on that field. Anything else becomes a form-level message, so nothing the API said is lost, and a failure fully shown at its fields is not repeated at the top.

**Enter submits with the first submit button in the markup.** When a form has a second submit that writes money ("Save and disburse"), that button must not come first in the DOM; place it with CSS `order` instead.

### Where a component lives

| Kind                                                                                                                                  | Home                  |
| ------------------------------------------------------------------------------------------------------------------------------------- | --------------------- |
| Generic, controlled, no `next` and no `@repo/contracts`                                                                               | `packages/ui`         |
| Knows a status, a line, a route or a contract (`StatusBadge`, `LineFilter`, `PageTrail`, `Money`, the column builders, the fallbacks) | `apps/web/components` |
| A hook that needs `next/navigation` (`useListState`), and framework-free helpers (`money.ts`, `format.ts`, `form-errors.ts`)          | `apps/web/lib`        |

**Statuses have one table**, `apps/web/components/status-badge.tsx` (`STATUS`, `StatusBadge kind value`). It is keyed by the contract enums, so a new enum value fails the type check until it has a label and tone. Do not write a local tone map.

### Three empty states, not one

A list must distinguish _nothing yet_ from _no matches_ from _not permitted_, because each calls for a different action:

- **`NothingYet`** — the user should create something. Offer the action.
- **`NoMatches`** — the user should change the filter. Offer to clear it.
- **`NotPermitted`** — neither. Takes no action prop on purpose.

The third matters more than it looks. Out-of-scope rows return `404` rather than `403`, so this component is often the only place a scoping boundary is visible at all. Telling a Junior to "add a customer" for a line they cannot see is worse than saying nothing, and an empty list that looks like "no data" hides a permissions problem from whoever is debugging it.

### Money never becomes a number

`formatCurrency` takes a **decimal string** and does its grouping with string operations. It never constructs a `Number` and never calls `toFixed`.

It rejects more than two decimal places rather than rounding or truncating. Every money column is `NUMERIC(14,2)`, so a third decimal means something upstream produced a value the database cannot store — hiding it at the display layer would turn a visible bug into a silent one. Rounding belongs in `@repo/domain`, at an explicit boundary (BR-11).

`formatBusinessDate` takes the plain `YYYY-MM-DD` string and deliberately does **not** accept a `Date`. Constructing one re-introduces a timezone, and a business date has none: it is the calendar day the money moved in Asia/Kolkata, decided once by `toBusinessDate` (BR-12). A business date never shows a time.

---

## Tailwind v4 traps

**Use `h-[var(--control-height)]`, not `h-[--control-height]`.** The bare-variable-in-brackets shorthand is Tailwind **v3** syntax; v4 removed it. It does not error — the utility is silently dropped, so a button renders with no height and no padding and looks like a broken component rather than a broken class name. This was caught by a screenshot at 360px, not by any test, which is why the viewport check below is a real step and not a formality.

**`@source` in `theme.css` must reach `@repo/ui`.** Tailwind scans only the importing project by default. Without it every `@repo/ui` class is purged from the production build.

**A new `@theme` scale goes into `cn()` too.** tailwind-merge only knows Tailwind's default scales, so `cn("text-label text-ink")` would read `text-label` as a colour and silently drop `text-ink`. `packages/ui/src/cn.ts` lists the theme's `text`, `shadow` and `radius` names; keep it in step with `theme.css`.

## Testing

`@repo/ui` has a Vitest suite in jsdom (`packages/ui/vitest.config.mts`), run by `pnpm test`:

- `theme.test.ts` holds every colour pairing to WCAG AA and rejects hex values.
- Component tests assert behaviour through Testing Library: accessible names, descriptions and `aria-invalid`, not class names.
- `src/test/setup.ts` fills in what jsdom lacks (`showModal`, `ResizeObserver`, pointer capture).

jsdom has no layout, so anything about size, wrapping or the 360px card view is checked in a browser.

## Writing a new component

1. **No boolean props for behaviour.** `tone="danger"`, not `danger`. If two booleans could contradict each other, they should have been one named variant.
2. **No `dense` prop.** Read the density variables.
3. **Explicit variants over modes.** If two states want different content and different actions, they are different components.
4. **Children over `renderX` props.**
5. **No `forwardRef`.** React 19 passes `ref` as a normal prop.
6. **Every list gets its three states**, plus loading. A skeleton matching the final layout, not a spinner.
7. **Destructive confirmations name the consequence.** "Write off account ACC-2026-00892 (₹4,200 outstanding)", never "Are you sure?".
8. **Icons from `@phosphor-icons/react` only**, `strokeWidth` 1.5. Never hand-roll an SVG path for an icon. Charts are the exception: they are drawn as SVG through `AreaChart` and `chart-scale.ts` (ADR-0015).
9. **Works at 360px.** Not "should be fine" — checked.

Run `ecc:design-system` in audit and slop-check mode before marking a UI story `Done`.

---

## Preview

`/design-system` in `apps/web` renders the token set and component base. It is not a product screen; `/` now redirects to `/home`, the signed-in entry point.

**Screen designs for the whole application** (32 screens, console and field app) were generated in Google Stitch on 2026-09-17 from [`stitch/DESIGN.md`](stitch/DESIGN.md), which restates these tokens for Stitch. The images and the prompts that made them are in [`stitch/`](stitch/README.md). They are references for building screens not yet built. A screen's spec still wins where the two disagree. If a token here changes, update `DESIGN.md` too.

It earns its place for now as a canary: if the `@source` directive in `theme.css` ever stops reaching `@repo/ui`, every class is purged from the production build and this page renders unstyled — obvious immediately, rather than in whichever feature screen ships next.
