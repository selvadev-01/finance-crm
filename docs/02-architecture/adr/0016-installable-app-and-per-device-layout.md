# ADR-0016 — An installable app, and a console layout chosen per device

**Status:** Accepted · **Date:** 2026-09-20 · **Revises:** [navigation-ia.md](../../05-ux/navigation-ia.md#responsive-behaviour), for console roles on a phone

## Context

Seniors use the console on a phone during the day and on a laptop in the evening ([navigation-ia](../../05-ux/navigation-ia.md#responsive-behaviour)). Admins increasingly do the same. On a phone the console was the desktop layout, folded: the sidebar became a slide-in drawer. Phone-width designs for every role were produced in Stitch ([stitch-mobile](../../05-ux/stitch-mobile/README.md)). They use an app bar and a bottom tab bar instead.

The owner asked for two things:

- Rasi should install like an app.
- Installing it should ask whether the device is used as a phone or as a computer, and the interface should switch to match.

Rasi was not installable. It had no web app manifest. The only service worker is the Junior's, scoped to `/route` ([ADR-0008](0008-offline-first-pwa.md)).

A browser gives a page no hook into its own install dialog. Chromium fires `beforeinstallprompt`, which a page can hold back and replay later. Safari and Firefox fire nothing, and they install from their own menus.

## Decision

**One installable app for every role.** `app/manifest.ts` declares:

- `start_url: /home`, which sends each person to their landing: a Junior's installed app opens the route, everyone else's opens the console;
- scope `/`, and `display: standalone`;
- generated icons (the teal "R" brand mark), plus an Apple touch icon and `appleWebApp` metadata for iOS.

The Junior's service worker keeps its own narrower scope and does not change.

**The console layout is a per-device choice, `phone` or `computer`.** It is stored in browser storage under `rasi.device.layout`, like the sidebar's pinned state. It is per device, not per person: a Senior's phone and laptop each keep their own answer. The same pages render in either layout; only the frame changes.

- **Computer:** the existing sidebar console (ADR-0015).
- **Phone:** `MobileShell` in `@repo/ui`: an app bar (the brand or a back arrow, the area, the bell), then the page, then a bottom tab bar. The tab bar has four tabs and a "More" bottom sheet. The four tabs are the role's dashboard, Collections, Customers and Cash; the dashboard tab reads Overview, Today or My line, for Super Admin, Admin and Senior. "More" lists every other area the role may see, grouped as the sidebar groups them, with the layout switch, install and sign out. `Dialog` gained `placement="sheet"` for this.

**When the question is asked:**

1. **When installing through Rasi.** Where the browser offers installation, the account menu shows "Install Rasi on this device". It asks for the layout first, then opens the browser's install dialog. The browser makes its offer once per page load, usually on the sign-in screen, so the offer is held from the root layout on every page, not by the console. The one exception is the Junior's `/route`, which has no account menu: there the browser shows its own install banner.
2. **On the installed app's first launch.** When the app runs standalone and no layout has been chosen, the console shows the question before anything else. This covers every browser, including installs from the browser's own menu and iOS "Add to Home Screen".
3. **At any time,** from the account menu (computer) or the "More" sheet (phone).

A plain browser tab with no choice is never interrupted. It shows the computer layout, which still folds to a drawer below 768px, as before.

**The Junior is never asked.** The field app is phone-only by design and keeps its own chrome: a status strip and no tab bar.

## Consequences

- The choice is convenience, not access control. Both layouts filter navigation with the same `navFor(role)` (`lib/console-nav.ts`), and every route is still refused by the API.
- Clearing site data, or storage that throws, loses the choice. The installed app then asks again on its next launch, and a tab falls back to the computer layout.
- Pages are shared between the two layouts. A page that has not yet been laid out for a phone still renders, folded by viewport width, inside the phone frame. The Stitch mobile designs are the target for each page; that work is tracked in the backlog.
- Choosing the phone layout on a wide screen gives the phone frame around full-width pages. That is allowed rather than prevented: the choice is the person's.
- Push notifications, the service worker and offline behaviour are unchanged. The console is still online-only.

## Alternatives considered

**Follow screen width alone, with no choice.** This was the previous behaviour. It was rejected because the owner asked for an explicit choice, and because width misreads real devices: a large phone in landscape, or a tablet used with a keyboard.

**A cookie, read by the server, so the frame renders before hydration.** Rejected for now. The console already waits for the signed-in user before drawing any frame, so a client-side choice causes no flash. A server-read cookie would also make every console route dynamic for no visible gain.

**Two apps: one manifest for the console and one for the route.** Rejected. It means two installs, two icons and two sign-ins on a Senior's phone, for a split the role-based `/home` redirect already makes.
