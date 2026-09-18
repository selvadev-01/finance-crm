# ADR-0013 — Console re-theme, a webfont, and headless libraries

**Status:** Accepted · **Date:** 2026-09-16 · **Partly supersedes:** [ADR-0010](0010-tailwind-v4-component-base.md)

> **Revised 2026-09-17: the palette.** The owner found the first "ledger" palette (navy ink on warm paper, square corners) too heavy and chose "soft teal":
>
> - light mint-grey neutrals;
> - a teal accent;
> - a yellow-green positive, a coral critical and a violet info, so no status is close to the accent;
> - gently rounded corners (8, 12 and 16px).
>
> The token names, the four status roles and the contrast test are unchanged, and every pairing still passes WCAG AA. [design-system.md](../../05-ux/design-system.md#colour) has the current values. Where this ADR says "ledger" below, read the palette as revised.

## Context

ADR-0010 set up Tailwind v4, a token file, two density modes and a small hand-built component base. The screens built on it since then work. The owner's judgement of them, though, was blunt: the console looks poor. Reading every screen showed why. It is not one bad component. The component base is too thin for the screens that use it, so each screen rebuilds the same things by hand, and each copy is slightly different:

- About 14 lists repeat the loading, failed, empty and table sequence.
- 7 detail pages repeat the same guard at the top.
- There are 7 local copies of a stat card.
- About 25 section headings are written by hand.
- 6 filter bars label their fields differently.
- About 11 dialogs rebuild the same pending/error state.
- About 15 status-to-colour maps are scattered across files.
- Validation is done three ways, and API errors are mapped to fields four ways.

On top of that:

- The palette had three measured contrast failures.
- The type is the system stack, with nothing to give the product a voice.
- The shell is a flat list of nine links.

ADR-0010 named shadcn/ui as the source of components. In practice no Radix, table or form library was ever installed, so every interactive primitive beyond a native `<dialog>` and `<select>` was left for the screens to improvise.

## Decision

**A full re-theme, "ledger": ink on paper.**

- **Colour:**
  - Warm paper neutrals with almost no chroma.
  - Deep ink-navy text and a single navy accent.
  - Four status tones, each with four roles:
    - The bare token (text, and solid fills) is held to 4.5:1 on white, on its own `-subtle` ground, and under inverse text.
    - `-subtle` is the tinted background.
    - `-border` is the tinted outline.
    - `-bright` is for dots and indicators, held to 3:1.
  - The bare names keep their meaning, so existing screens, including the field app, pick up the fixed contrast without edits.
- **Type:** IBM Plex Sans and IBM Plex Mono, with role sizes (`display`, `title`, `heading`, `body`, `label`, `caption`) rather than a numeric scale.
- **Shape:** squarer radii (`control`, `surface`, `overlay`, `pill`) and shadows only for things that float.
- **Enforcement:** `packages/ui/src/theme.test.ts` asserts every text/background pairing, so a future colour change cannot quietly break contrast.

**A webfont for the console and sign-in screens only.**

- IBM Plex is self-hosted by `next/font` with `preload: false`. A font file is fetched only when text on the page uses it.
- The Junior's field app sets `data-font="system"`, which redeclares both font stacks for its subtree. It never downloads Plex.
- `latin-ext` carries ₹. A browser check confirmed the glyph comes from Plex, not a fallback.

**Headless libraries, adopted rather than improvised:**

| Library                                              | Used for                                                                                                | Replaces                                              |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| **Radix** (`radix-ui`), with `cmdk` for the combobox | Checkbox, Switch, Tabs, Popover, DropdownMenu, Combobox, Toast, Tooltip                                 | This is the shadcn route ADR-0010 intended            |
| **TanStack Table**                                   | Headless model under a `DataView` compound component (table from 768px, cards below, cursor pagination) | Hand-written list states                              |
| **react-hook-form** with the zod resolver            | `Form`, `FormField`, `DialogForm`, run over the contract schemas that already exist                     | Three validation styles and four error-mapping styles |

**Placement.**

- `@repo/ui` stays generic: it imports neither `next` nor `@repo/contracts`.
- Anything that knows a domain status, a line or a route lives in `apps/web/components/`.
- Hooks that need `next/navigation` live in `apps/web/lib/`.

**Unchanged from ADR-0010:**

- Tailwind v4 and `theme.css` as the only source of tokens.
- Density through `data-density` variables, never a `dense` prop.
- Explicit `cva` variants, never boolean props.
- Phosphor icons.
- Native `<dialog>` for modals. Radix overlays inside a dialog portal into that dialog, so they stay in the top layer.
- Bundler resolution for `@repo/ui`.

## Alternatives considered

**Polish within the old tokens.** Consistency without a new look. Rejected by the owner: the complaint was about the look as much as the duplication.

**Stay fully hand-built.** No new dependencies. Rejected for the same reason ADR-0010 gave and then did not act on: a combobox, a toast region and a menu with correct focus and ARIA are easy to get subtly wrong. The combobox is what the 1,000-customer onboarding needs.

**Inter or Geist instead of Plex.** Both are good and both are everywhere, which is exactly the "generic" look being replaced. Plex's even colour and true tabular figures suit columns of rupees, and its latin-ext subset includes ₹.

**Dark mode now.** Rejected, again. Every status pair would need a second contrast audit and a sunlight check on the Junior's phone. The tokens are named by role, so dark mode can later be a second `@theme` block. No `dark:` utilities are allowed meanwhile.

## Consequences

**`cn()` is configured with the theme's scales.** tailwind-merge otherwise reads `text-label` as a text _colour_ and drops the `text-ink` beside it. A new `@theme` scale must be added in `packages/ui/src/cn.ts`.

**`@repo/ui` has a jsdom test suite** (`vitest.config.mts`), run by `pnpm test`. It holds the contrast pairs, the ARIA wiring of `Field`, and the class merging.

**The field app is recoloured too**, because the tokens are shared. That is intended: its badge contrast failures are fixed. But each token change must be checked on `/route` at 360px, including in sunlight.

**New dependencies must be older than pnpm's `minimumReleaseAge`**, and are pinned to exact versions rather than added to the exclude list.

**The migration is phased** (backlog, Phase 6: "Console UI overhaul"). Old and new components coexist until the last screen moves, and then the transitional aliases are deleted.
