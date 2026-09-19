# Design System: Rasi Mobile, every role on one phone

Rasi runs a daily-collection finance business: 1,000+ customers, 10+ collection lines, four roles (Super Admin, Admin, Senior, Junior). This file describes **the whole product at phone width (390px)** for Google Stitch: the Junior's offline field app and the admin console as a Super Admin, Admin or Senior sees it on a phone.

It restates `packages/ui/src/theme.css` and extends the desktop Stitch system in [../stitch/DESIGN.md](../stitch/DESIGN.md) to mobile. Tokens are identical; only layout, navigation and component shapes change. Where this file and [screen-specs.md](../screen-specs.md) disagree, the spec wins.

## 1. Visual Theme & Atmosphere

**Soft teal: calm, fresh, trustworthy, held in one hand.** The mood is a well-run branch office on a bright morning, fitted into a pocket: quiet mint surfaces, one confident teal, and rupee figures that line up.

- **Density:** Senior, Admin and Super Admin screens are **"Daily App Balanced" (5/10)**. They are phone versions of a dense tool: stacked cards instead of tables, 2 × 2 figure grids instead of 4-column strips. Junior screens are **"Art Gallery Airy" (3/10)**: one task per screen, 44px minimum targets, and amounts large enough to read in direct sunlight.
- **Variance: 3/10.** Predictable, left-aligned, the same skeleton on every screen. Staff open these screens hundreds of times a day; trust matters more than surprise.
- **Motion: 2/10.** Colour transitions, a 1px press, and bottom sheets that rise over 180ms. Nothing loops, bounces, floats or pulses except the small "Syncing" mark.

Money is the product. Every amount is Indian rupees with Indian digit grouping, **₹1,23,456.50**, in tabular figures.

## 2. Color Palette & Roles

**Neutrals:** a light mint-grey with a trace of the accent hue. Never pure grey, never pure black.

- **Mint Canvas** (#F5FBFA): page background behind everything.
- **Pure Surface** (#FFFFFF): cards, list rows, sheets, inputs, the bottom tab bar and top app bar.
- **Sunken Mint** (#ECF5F4): wells, read-only values, pressed rows, the sheet's footer band, skeletons.
- **Nav Mint** (#E6F1F0): the tab bar's active pill and the "More" sheet's group backgrounds.
- **Hairline** (#DAE6E5): 1px dividers and card borders.
- **Control Outline** (#7F9092): input, select and stepper borders, 3:1 against white.
- **Deep Slate Ink** (#14242B): primary text, headings, amounts.
- **Muted Slate** (#45565B): secondary text, addresses, descriptions.
- **Subtle Slate** (#5B696D): captions, timestamps, figure labels, placeholders.

**Accent:** one accent only.

- **Rasi Teal** (#007370): primary buttons, links, the active tab, focus rings, selected chips, progress fill.
- **Teal Hover** (#006160): pressed state of teal buttons.
- **Teal Wash** (#DBF7F3): active tab pill, selected chip background, selected list row.
- **On Teal** (#F9FDFC): text and icons on teal.

**Status:** reserved for status. A collection's classification, sync state, day state, discrepancies and approvals. Never decoration.

| Tone                  | Strong  | Wash    | Edge    | Dot     | Means                                                      |
| --------------------- | ------- | ------- | ------- | ------- | ---------------------------------------------------------- |
| Positive (leaf green) | #36692A | #E4F9DA | #B5DBA8 | #4A9C36 | Collected as expected, sent, tallied, acknowledged, active |
| Warning (amber)       | #875315 | #FFF2D2 | #F2CA8D | #CB7300 | Low payment, saved on phone, waiting, closed, overdue      |
| Critical (coral)      | #AB3B2D | #FFEDEA | #F9C6BD | #D9553F | Missed, no payment, disputed, short, not accepted, danger  |
| Info (violet)         | #694B96 | #F4EEFF | #D9CDF1 | #8864C0 | Extra payment, syncing, pending approval, informational    |

Violet is a status tone only; it never appears on a button, a tab or a heading.

## 3. Typography Rules

- **Typeface: IBM Plex Sans** for every role (the built Junior app uses the phone's system sans instead; designs may show Plex). An engineered, even face with true tabular figures and a proper ₹ glyph. Weights 400, 500, 600 only.
- **Codes: IBM Plex Mono**, small and muted, for customer codes (CUS-00412), account codes (ACC-2026-0091) and line codes (LN-07).
- **Mobile role sizes:**

  | Role         | Size / line height | Weight | Used for                                                |
  | ------------ | ------------------ | ------ | ------------------------------------------------------- |
  | Screen title | 22 / 28px          | 600    | One per screen, under the app bar, tracking −0.01em     |
  | Hero amount  | 28 / 34px          | 600    | The one number a screen exists for (collected today)    |
  | Amount       | 20 / 26px          | 600    | Figure values, a row's key amount                       |
  | Heading      | 16 / 22px          | 600    | Section titles, card titles, sheet titles               |
  | Body         | 16 / 22px          | 400    | Row text, paragraphs, input text (16px stops iOS zoom)  |
  | Label        | 14 / 20px          | 500    | Field labels, chips, secondary buttons, tab labels 12px |
  | Caption      | 13 / 18px          | 400    | Timestamps, hints, metadata                             |
  | Overline     | 12 / 16px          | 500    | Uppercase figure labels only, wide tracking             |

- Nothing below 12px anywhere; nothing below 14px on a Junior screen.
- **Numbers:** tabular figures everywhere; amounts right-aligned in rows.
- **Banned:** serif fonts, Inter, monospace for body text, all-caps headings.

## 4. Component Stylings

- **Top app bar.** 56px, white, bottom hairline, respects the phone's safe area. Left: a back arrow (detail screens) or the brand mark (teal rounded square with a white "R") on a tab's root. Centre-left: the area name in 16px semibold. Right: at most two 44px icon buttons, the bell with a small coral count, and one contextual action ("New", filter, overflow). No search bar in the app bar; search lives on the screen.
- **Bottom tab bar (Super Admin, Admin, Senior only).** 64px plus safe area, white, top hairline, five items: four destinations and "More". Each item is a Phosphor icon over a 12px label. The active item sits in a 64 × 32px Teal Wash pill with a filled teal icon and teal label; inactive items are Subtle Slate. A coral count may sit on Collections (pending approvals) or Cash (handovers waiting). The Junior app has **no tab bar**.
- **"More" sheet.** A bottom sheet listing the role's remaining areas in grouped white cards (Records, Reports, System), each row a 56px tappable line with an icon, a label and a chevron. The account card at the top shows initials, name and role, with "Sign out" at the foot.
- **Buttons.** 8px corners. 48px tall in console screens, 52px for a Junior's primary action. Tones:
  - Primary: Rasi Teal fill, On Teal text, full width on phones.
  - Secondary: white with a Hairline border and Deep Slate Ink text.
  - Ghost: text only, Sunken Mint when pressed.
  - Danger: Coral Strong fill with white text, for write-offs, reversals, suspension, reopening a day.
  - Behaviour: a 1px press; no glows, no gradients. Labels say what happens: "Confirm ₹100.00", "Close day", "Hand over ₹8,450.00 to Karthik R". Labels never wrap.
- **Sticky action bar.** Forms and decision screens pin their commit buttons to a white bar at the bottom with a top hairline and safe-area padding: secondary on the left, primary on the right, or one full-width primary.
- **List rows as cards.** Every desktop table becomes a stack of white rows with 12px corners and a hairline border, or one white card holding ruled rows. A row: the identity on top (name in 16px medium, the mono code beneath in 13px muted), key amount right-aligned, then one line of label and value pairs in Caption, then the status badge. The whole row is tappable, with a chevron at the right edge.
- **Figure grid.** Figures sit in one white card split into a 2 × 2 grid by hairlines. Each has an uppercase Overline label ("EXPECTED"), an Amount-size tabular value and an optional caption. A figure is coloured only when it is itself a status. A figure that cannot be computed shows "—" with the caption "Unavailable", never ₹0.00.
- **Progress.** A thin 6px teal bar on a Sunken Mint track for collected against expected. Nothing else uses progress bars.
- **Filter chips.** A horizontally scrolling row of 36px chips under the screen title ("17 Sep", "LN-07", "Low", "Correction"). A set chip is Teal Wash with teal text and an × to clear; the last chip is "Filters" and opens a filter sheet with labelled controls and an "Apply" button. The chip row is the only horizontal scroll on any screen.
- **Segmented control.** For a record's tabs (Profile, Accounts, History): a Sunken Mint track with a white raised segment for the current tab. At most four segments.
- **Badges.** Small, 6px-rounded rectangles, not pills. A coloured Dot, Strong text on the Wash, an Edge border. Neutral badges ("Completed", "Inactive", "Open") use Sunken Mint and Muted Slate with no dot.
- **Inputs.** Label above in Label weight, hint or error below in Caption. White field, 8px corners, Control Outline border, 48px tall, 16px text. Focus: teal border with a soft teal ring. Error: coral border, coral error text replacing the hint. Money inputs right-aligned with a ₹ prefix; a Junior's amount input is 56px tall with 24px text. Pickers (line, staff, customer) open a full-height sheet with a search box and a check mark on the chosen row. Dates open the phone's native picker.
- **Stepper.** For denomination counts: a 44px − circle, a centred number input, a 44px + circle, and the subtotal right-aligned in muted tabular text.
- **Bottom sheets (replace desktop dialogs).** White, 16px top corners, a small grab handle, over a 35% slate scrim. The title names the consequence ("Close LN-07 · Market Road for 16 Sep 2026"), never "Are you sure?". The footer is a Sunken Mint band with Cancel (ghost) and the commit button.
- **Messages.** Full-width callouts with an icon, 8px corners, a status Wash background and an Edge border. At most one action inside.
- **Connection banner.** Console roles work online. When the phone loses signal a slim amber banner sits under the app bar: "You're offline. Figures shown are from 10:42 am." The Junior app instead has its permanent status strip (section 5).
- **Loading.** Skeleton blocks in Sunken Mint in the exact shape of the rows and figures. No spinners except the small Junior "Syncing" mark.
- **Empty states.** A composed block in the list area: a 40px Phosphor icon in a Teal Wash tile, a heading, one sentence, one action. Three kinds: _nothing yet_ (offer to create), _no matches_ (offer to clear filters), _not permitted_ (no action). The Junior's empty route has three more: Sunday, a declared holiday, nothing due.
- **Toasts.** A white card above the tab bar with a status icon and one line: "Line LN-07 created".
- **Icons.** Phosphor Icons, regular weight, 20–24px, stroke 1.5. Never emoji, never hand-drawn marks.

## 5. Layout Principles

- **Canvas:** 390 × 844 phone, 16px side padding, 16px between cards, 24px between sections. One column always. No horizontal scroll except the filter chip row.
- **Console roles (Super Admin, Admin, Senior):** top app bar, scrolling content, bottom tab bar. The tab bar is role-shaped:

  | Tab 1                                                     | Tab 2       | Tab 3     | Tab 4 | Tab 5 |
  | --------------------------------------------------------- | ----------- | --------- | ----- | ----- |
  | Overview (Super Admin) / Today (Admin) / My line (Senior) | Collections | Customers | Cash  | More  |
  - **More, Super Admin:** Records (Lines, Sectors, Team) · Reports · System (Business settings, Holidays, Audit log, Refused attempts).
  - **More, Admin:** Records (Lines, Sectors, Team) · Reports · System (Holidays, Audit log, Refused attempts).
  - **More, Senior:** Records (My line, Team) · Reports (own line) · Holidays.
  - Items a role may not use are absent, never greyed out.

- **Screen skeleton:** app bar → screen title and a one-line meta (date, line, "updated 10:42 am") → optional filter chips → the primary figure card → sections, each with a 16px heading and at most one "See all" link at the heading's right.
- **Drill-down:** Business → Sector → Line → Customer → Account → Collection, each a pushed screen with a back arrow. A small trail line under the title ("Customers / Kumar Traders") shows where the screen sits. Maximum three levels below a tab.
- **Junior app:** no tab bar, no drawer. A fixed **status strip** under the safe area on every screen: a dot and "Online" (green) or "Offline" (amber) at left, an amber "2 not sent" chip in the middle when entries are queued, the bell at right. The route is home; every other view has "← Route" and returns there.
- **Forms:** one column, grouped in white cards, commit in the sticky action bar.

## 6. Motion & Interaction

- Colour transitions 150ms ease-out on press and focus.
- Buttons press down 1px.
- Bottom sheets rise 180ms ease-out over a fading scrim; pushed screens slide 200ms from the right.
- Skeletons shimmer softly and stop entirely under reduced motion.
- Nothing animates on scroll or loops, apart from the Junior's "Syncing" mark while it is true.

## 7. Anti-Patterns (Banned)

- **Styling:** no emoji, no pure black, no purple or blue neon, no glows, no gradients, no glassmorphism, no dark mode, no drop shadows beyond a 1px slate tint on raised cards and a soft shadow under sheets.
- **Layout:** no floating action button, no hamburger drawer on phones (the "More" tab replaces it), no marketing hero, no carousel, no "3 equal cards", no horizontal-scrolling tables, no pills for every chip, no oversized radii (12px cards, 8px controls, 16px sheet tops, 6px badges).
- **Colour:** status colour is never decoration; teal is the only action colour; no green primary button; violet never on an action.
- **Copy and data:**
  - No generic names (John Doe, Acme). Use Indian names and shops: Kumar Traders, Selvi Stores, Anbu Tea Stall, Fathima Textiles, Balaji Provisions; staff Lakshmi K, Karthik R, Priya S, Murugan K, Divya M.
  - Lines look like "LN-07 · Market Road"; sectors like "North", "Town Centre". The middle dot appears only in that line format and in meta lines.
  - Real-looking rupee amounts: ₹1,250.00, ₹27,850.00, ₹4,200.00. No round fake numbers or percentages.
  - Dates as "17 Sep 2026"; business dates never show a time.
  - No AI clichés (elevate, seamless, unleash), no filler ("Scroll to explore"), no version stamps, no decorative dots.
  - The long dash "—" appears only as the unavailable-figure mark, never as punctuation in copy.
- **Data exposure (RBAC):**
  - A Junior never sees invested amount or profit, and never sees another line.
  - A Senior sees only their own line: no business or sector totals.
  - Business and sector totals appear only for Super Admin and Admin.
