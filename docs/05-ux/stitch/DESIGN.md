# Design System: Rasi — Daily Collections

Rasi runs a daily-collection finance business. It replaces a shared spreadsheet and a paper register for 1,000+ customers, 10+ collection lines, and four roles: Super Admin, Admin, Senior and Junior. It is two products in one:

- **The admin console**, used on desktop and tablet by Super Admin, Admin and Senior. It is a dense operations tool: tables, filters, figures and approvals.
- **The Junior field app**, a phone-only screen at 360px. It is used one-handed, outdoors, often offline, to record what each customer paid at their door.

The source of truth for these tokens is `packages/ui/src/theme.css` in the repository. This file restates them for Google Stitch.

## 1. Visual Theme & Atmosphere

**Soft teal: calm, fresh, trustworthy.** The mood is a well-run branch office on a bright morning: quiet surfaces, one confident colour, and figures that line up.

The console is **"Daily App Balanced" leaning dense (density 7/10)**: compact rows, 36px controls, many columns. The Junior app is **"Art Gallery Airy" (density 3/10)**: 44px minimum touch targets and one task per screen.

Variance is low (3/10). Layouts are predictable and left-aligned, because staff scan the same screens hundreds of times a day, and trust matters more than surprise. Motion is restrained (2/10): colour transitions on hover, a 1px press, and a 120ms fade for dialogs. Nothing loops, bounces or pulses.

Money is the product. Every amount is shown in Indian rupees with Indian digit grouping, **₹1,23,456.50**, in tabular figures so columns align.

## 2. Color Palette & Roles

**Neutrals.** A light mint-grey with a trace of the accent hue; never pure grey, never pure black.

- **Mint Canvas** (#F5FBFA): page background.
- **Pure Surface** (#FFFFFF): cards, tables, dialogs, inputs.
- **Sunken Mint** (#ECF5F4): table header rows, wells, disabled inputs, hover rows.
- **Hairline** (#DAE6E5): 1px dividers and card borders.
- **Control Outline** (#7F9092): input and select borders, 3:1 against white.
- **Deep Slate Ink** (#14242B): primary text and headings.
- **Muted Slate** (#45565B): secondary text and descriptions.
- **Subtle Slate** (#5B696D): hints, captions, column headers, placeholder text.

**Accent.** One accent only.

- **Rasi Teal** (#007370): primary buttons, links, the current navigation item, focus rings and selected states.
- **Teal Hover** (#006160): hover and press state of primary buttons.
- **Teal Wash** (#DBF7F3): background of the current navigation item and of selections.
- **On Teal** (#F9FDFC): text on teal.

**Status.** Status colour is reserved for status: a collection's classification, sync state, day state, discrepancies and approvals. It is never decoration. Each tone has four roles:

- **Strong:** text, or a solid fill with white text.
- **Wash:** the tinted background of a badge or message.
- **Edge:** the badge or message border.
- **Dot:** a small indicator.

| Tone                  | Strong  | Wash    | Edge    | Dot     | Means                                                        |
| --------------------- | ------- | ------- | ------- | ------- | ------------------------------------------------------------ |
| Positive (leaf green) | #36692A | #E4F9DA | #B5DBA8 | #4A9C36 | Collected as expected, reconciled, active, acknowledged      |
| Warning (amber)       | #875315 | #FFF2D2 | #F2CA8D | #CB7300 | Low payment, waiting, saved on phone, not yet sent           |
| Critical (coral)      | #AB3B2D | #FFEDEA | #F9C6BD | #D9553F | Missed, no payment, disputed, shortfall, destructive actions |
| Info (violet)         | #694B96 | #F4EEFF | #D9CDF1 | #8864C0 | Extra payment, syncing, pending, informational notes         |

**Badges** are small, gently rounded rectangles, not pills. They have a coloured Dot, Strong text on the Wash background, and an Edge border. A neutral badge ("Completed", "Inactive") has no dot and uses Sunken Mint with Muted Slate text.

## 3. Typography Rules

- **All text: IBM Plex Sans.** It is an engineered, even face with true tabular figures and a proper ₹ glyph. Weights are 400, 500 and 600 only.
- **Codes and identifiers: IBM Plex Mono**, for customer codes (CUS-00412) and account codes (ACC-2026-0091), shown small and muted under a name.
- **Role sizes** (console):

  | Role     | Size / line height | Weight | Used for                                                        |
  | -------- | ------------------ | ------ | --------------------------------------------------------------- |
  | Display  | 26 / 34px          | 600    | The page title, one per page, tracking −0.015em                 |
  | Title    | 19 / 26px          | 600    | A record's name, a figure's value                               |
  | Heading  | 15 / 22px          | 600    | Section and dialog titles                                       |
  | Body     | 14 / 20px          | 400    | Table cells and paragraphs                                      |
  | Label    | 13 / 18px          | 500    | Field labels and small buttons                                  |
  | Caption  | 12 / 16px          | 400    | Hints and metadata                                              |
  | Overline | 11 / 16px          | 500    | Uppercase, wide tracking; column headers and figure labels only |

- **Junior app:** body 16px, amounts 20–24px semibold, buttons 16px. Nothing below 14px.
- **Numbers:** tabular figures everywhere, right-aligned in tables.
- **Banned:** serif fonts, Inter, and monospace for body text.

## 4. Component Stylings

- **Buttons.**
  - Shape and size: 8px corners; 36px tall in the console, 44px in the Junior app.
  - Tones:
    - Primary: Rasi Teal fill, On Teal text.
    - Secondary: white with a Hairline border.
    - Ghost: text only, with a Sunken Mint hover.
    - Danger: Coral Strong fill with white text, for write-offs, reversals, deactivation and reopening a day.
    - Link: teal text, underlined on hover.
  - Behaviour: a 1px press on active; no glows, no gradients. Labels say what happens: "Save and disburse", "Close day", "Reverse ₹500.00".
- **Cards.** White, a 1px Hairline border, 12px corners, and at most a 1px soft shadow tinted slate. Use them only where the boundary means something: a settings panel, a list of references, a handover. In dense views, prefer ruled rows.
- **Figures (stat strip).** Figures sit side by side in one ruled frame, with hairline dividers and no card per figure. Each has an uppercase Overline label ("EXPECTED"), a Title-size tabular value (₹30,000.00), and an optional caption ("of 60 slots"). A figure is coloured only when it is itself a status (a shortfall in amber or coral).
- **Tables.**
  - Frame: white, a 1px border, 12px corners.
  - Header row: Sunken Mint with uppercase Overline column headers.
  - Rows: 40px, with hairline separators and a Sunken Mint hover.
  - First column: the record's identity, a medium-weight name as a link with its mono code beneath.
  - Numbers and status badges are right-aligned. Sortable headers show a small up-down arrow.
  - Below 768px, each row becomes a card: the name on top, then label and value pairs.
  - Beneath the table is a quiet footer, "48 customers", with a secondary "Show more" button.
- **Filter bar.** A row of labelled controls above the list (From, To, Line, Show), each with its label above it. "Clear filters" is a teal link at the right.
- **Inputs.** The label sits above the field in Label weight; the hint or error sits below in Caption.
  - Field: white with an 8px corner and a Control Outline border.
  - Focus: a teal border with a soft teal ring.
  - Error: a coral border, with coral error text replacing the hint.
  - Money inputs are right-aligned with a ₹ prefix; there are no floating labels.
  - Searchable pickers (line, staff, customer) are comboboxes: a trigger showing the chosen value, and a floating list with a search box and a check mark.
- **Page header.**
  - Breadcrumb trail above in Label: "Customers / Kumar Traders / ACC-2026-0091".
  - Display title, then a meta line with the mono code and a status badge.
  - Page actions on the right.
  - A hairline rule beneath.
- **Dialogs.**
  - Frame: centred, 16px corners, white, a soft large shadow, over a 35% slate scrim.
  - Title: names the consequence ("Deactivate line LN-07"), never "Are you sure?".
  - Footer: a sunken band holding Cancel (ghost) then the commit button, right-aligned.
- **Messages.** Full-width callouts with an icon, 8px corners, and a status Wash background with an Edge border. A message may carry one action ("Save anyway").
- **Loading.** Skeleton bars in Sunken Mint, in the shape of the content. No spinners, except the small Junior "Syncing" mark.
- **Empty states.** A composed centred block inside the table frame: a heading ("No customers yet"), one sentence, and one action. There are three distinct kinds: _nothing yet_ (offer to create), _no matches_ (offer to clear filters) and _not permitted_ (no action).
- **Toasts.** A small white card, bottom-right, with a status icon, used for "Line LN-07 created".
- **Icons.** Phosphor Icons, regular weight, 16–20px. Never emoji.

## 5. Layout Principles

- **Console shell.**
  - **Left sidebar**, 240px wide on desktop and a 64px icon rail on tablet. Contents:
    - The brand at the top: a teal rounded square with "R", and "Rasi".
    - Grouped navigation with small uppercase group labels. **Operate:** Dashboard, Collections, Cash. **Records:** Customers, Lines, Sectors, Team. **System:** Notifications, Audit log.
    - The current item: a teal wash with teal text and a 2px teal bar on its left.
  - **Top bar**, 52px, white with a bottom hairline: the current area name on the left; the notification bell with a coral count and the account menu (initials avatar, name, role) on the right.
  - **Page body:** max width 1152px (1536px for wide lists), with 32px padding and 28px between sections.
- **Phone (below 768px):** the sidebar becomes a slide-in drawer opened from a menu button, and every multi-column layout collapses to one column. No horizontal scroll.
- **Junior app:** no sidebar and no tab bar.
  - A fixed top status bar: online or offline, the count of unsent entries, and the bell.
  - One screen at a time; "← Route" always returns home.
  - 16px side padding, and 44px minimum targets throughout.
- **Grid first:** figure strips are 2, 3 or 4 columns, and detail pages use a two-column layout (form left, preview right) on wide screens. Do not use a row of three identical marketing cards.

## 6. Motion & Interaction

- Colour transitions: 150ms ease-out on hover and focus.
- Buttons press down 1px on active.
- Dialogs and popovers fade in over 120ms with a 2px rise.
- Skeletons pulse softly, and stop entirely when reduced motion is preferred.
- Nothing animates on scroll or loops forever. This is a work tool used all day.

## 7. Anti-Patterns (Banned)

- **Styling:**
  - No emoji and no pure black.
  - No purple or blue neon, no glows, no gradients, no glassmorphism or backdrop blur.
  - No dark mode.
- **Layout:**
  - No marketing hero, no centred landing layout, no "3 equal feature cards".
  - No oversized radii on dense tables.
  - No pills for every chip; badges are small rounded rectangles.
- **Colour:**
  - No status colour used as decoration.
  - No green primary button: teal is the only action colour.
  - No fake zeros: a figure that cannot be computed shows "—" or "Unavailable", never ₹0.
- **Copy and data:**
  - No generic names (John Doe, Acme). Use Indian names and shops: Kumar Traders, Selvi Stores, Anbu Tea Stall, Priya, Murugan, Lakshmi.
  - Lines look like "LN-07 · Market Road"; sectors like "North" and "Town Centre".
  - No round fake numbers. Use real-looking rupee amounts: ₹1,250.00, ₹27,850.00, ₹4,200.00.
  - No AI copy clichés (elevate, seamless, unleash).
  - No filler ("Scroll to explore").
- **Data exposure:** never show invested amount or profit on a Junior screen.
