# Design system

Tokens, density, and the component base in [`@repo/ui`](../../packages/ui). The decision behind the stack is [ADR-0010](../02-architecture/adr/0010-tailwind-v4-component-base.md); this document is what to follow when building a screen.

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

| Variable              | `comfortable` (default) | `compact`        |
| --------------------- | ----------------------- | ---------------- |
| `--control-height`    | `2.75rem` (44px)        | `2.25rem` (36px) |
| `--control-padding-x` | `1rem`                  | `0.75rem`        |
| `--row-padding-y`     | `0.875rem`              | `0.5rem`         |
| `--stack-gap`         | `1rem`                  | `0.625rem`       |

The root layout sets `compact` because the console is the larger surface. The Junior's route segment sets `comfortable` on its own layout, and every control inside widens with no component change.

**44px is a floor, not a target, for anything the Junior taps.** It is the number that survives a gloved thumb.

---

## Colour

One accent, locked across the whole product. Neutrals are a single cool grey family — never warm and cool mixed in one interface.

The accent is a deep green. This is a cash-handling tool whose recurring semantic is money reconciling correctly, and green already carries "tallied". The accent is deliberately far enough from the status greens to avoid being read as a collection state.

| Role    | Token                                                                                          | Used for                                             |
| ------- | ---------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| Surface | `--color-surface`, `--color-surface-raised`, `--color-surface-sunken`                          | Page, cards, wells                                   |
| Line    | `--color-border`, `--color-border-strong`                                                      | Dividers, input outlines                             |
| Text    | `--color-ink`, `--color-ink-muted`, `--color-ink-subtle`, `--color-ink-inverse`                | Four levels, no more                                 |
| Accent  | `--color-accent`, `-hover`, `-subtle`, `-ink`                                                  | Primary action only                                  |
| Status  | `--color-positive`, `--color-warning`, `--color-critical`, `--color-info`, each with `-subtle` | Collection classification, sync state, discrepancies |

**Status colour is reserved for status.** An accent button is not `positive` because the action is good; positive means a collection reconciled.

Every pairing meets WCAG AA against its own background. Status colours must stay distinguishable from each other **in sunlight on a mid-range screen**, which is a stricter test than a contrast ratio — it is why the warning is amber rather than yellow.

No dark mode yet, deliberately. See ADR-0010.

---

## Type

System font stack. No webfont: a render-blocking font request buys nothing a collector notices on a poor connection.

`font-variant-numeric: tabular-nums` applies to tables and anything marked `data-numeric`. Money is compared down a column constantly, and proportional digits make that harder for no benefit.

One extra step below Tailwind's scale, `--text-2xs` (11px), exists for badges and metadata. It is not for body text.

---

## Shape, elevation, motion

One radius scale: `--radius-control` for buttons and inputs, `--radius-surface` for cards and dialogs. Mixing pill buttons with square cards is broken design; pick the scale and apply it.

Shadows are tinted to the background hue, never pure black, and kept shallow. This is a dense data tool, not a marketing page. Cards are used only where elevation communicates real hierarchy — otherwise group with a border or with space.

Focus is **always visible**. A 2px accent outline with a 2px offset, applied globally. Never remove it without replacing it with something at least as clear.

Motion is minimal and functional: a colour transition on hover, a 1px translate on press so a gloved tap registers visibly. Anything more must justify itself as hierarchy, feedback, or state change.

---

## Component base

What exists today. The inventory grows with the screens, not ahead of them.

| Component                                   | Notes                                                                             |
| ------------------------------------------- | --------------------------------------------------------------------------------- |
| `Button`                                    | `tone`: `primary` · `secondary` · `ghost` · `danger`. Defaults to `type="button"` |
| `Badge`                                     | `tone`: `neutral` · `positive` · `warning` · `critical` · `info`                  |
| `NothingYet` / `NoMatches` / `NotPermitted` | Three empty states, three components                                              |
| `formatCurrency`                            | Decimal string in, `₹1,23,456.00` out                                             |
| `formatBusinessDate`                        | `YYYY-MM-DD` in, `13 Sep 2026` out                                                |
| `cn`                                        | Class merge where later Tailwind utilities win                                    |

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

## Writing a new component

1. **No boolean props for behaviour.** `tone="danger"`, not `danger`. If two booleans could contradict each other, they should have been one named variant.
2. **No `dense` prop.** Read the density variables.
3. **Explicit variants over modes.** If two states want different content and different actions, they are different components.
4. **Children over `renderX` props.**
5. **No `forwardRef`.** React 19 passes `ref` as a normal prop.
6. **Every list gets its three states**, plus loading. A skeleton matching the final layout, not a spinner.
7. **Destructive confirmations name the consequence.** "Write off account ACC-2026-00892 (₹4,200 outstanding)", never "Are you sure?".
8. **Icons from `@phosphor-icons/react` only**, `strokeWidth` 1.5. Never hand-roll an SVG path.
9. **Works at 360px.** Not "should be fine" — checked.

Run `ecc:design-system` in audit and slop-check mode before marking a UI story `Done`.

---

## Preview

`/` in `apps/web` renders the token set and component base. It is not a product screen; replace it when M01 lands.

It earns its place for now as a canary: if the `@source` directive in `theme.css` ever stops reaching `@repo/ui`, every class is purged from the production build and this page renders unstyled — obvious immediately, rather than in whichever feature screen ships next.
