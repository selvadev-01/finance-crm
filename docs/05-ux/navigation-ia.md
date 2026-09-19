# Navigation and Information Architecture

PDF §25 lists nine areas: Dashboard, Customers, Sectors, Lines, Collections, Team, Notifications, Reports, Settings — and says navigation changes by role.

This document says how.

---

## Two applications, one deployment

| Surface           | Roles                      | Device             | Shell                    |
| ----------------- | -------------------------- | ------------------ | ------------------------ |
| **Admin console** | Super Admin, Admin, Senior | Desktop and tablet | Sidebar navigation       |
| **Field app**     | Junior                     | Phone              | **No navigation chrome** |

One Next.js deployment, routed by role at sign-in. A Junior signing in never sees the console shell; a Super Admin never sees the route screen.

---

## Navigation by role

| Item          | Super Admin | Admin |  Senior   |   Junior    |
| ------------- | :---------: | :---: | :-------: | :---------: |
| Dashboard     |      ✓      |   ✓   | Line view |  **Route**  |
| Customers     |      ✓      |   ✓   | Own line  |  Assigned   |
| Sectors       |      ✓      |   ✓   |     —     |      —      |
| Lines         |      ✓      |   ✓   | Own line  |      —      |
| Collections   |      ✓      |   ✓   |     ✓     | Own entries |
| Team          |      ✓      |   ✓   | Own line  |      —      |
| Notifications |      ✓      |   ✓   |     ✓     |      ✓      |
| Reports       |      ✓      |   ✓   |  Limited  |      —      |
| Settings      |      ✓      |   —   |     —     |      —      |

**As built, the console sidebar is grouped** by what a person is doing (ADR-0013). Only the areas whose screens exist are listed; Settings joins when it is built.

| Group   | Items                                                                     |
| ------- | ------------------------------------------------------------------------- |
| Operate | Dashboard, Collections, Cash, Reports                                     |
| Records | Customers, Lines, Sectors (Admin and above), Team                         |
| System  | Notifications, Holidays, Audit log and Refused attempts (Admin and above) |

**Reports** (US-084) is one sidebar item for every console role — Super Admin, Admin and Senior — and it opens `/reports`, an index of the reports that exist, rather than a particular report. There are five reports specified and each is a different question, so a sidebar entry per report would grow the navigation faster than the product; the index is the one page each report story adds itself to. A Senior's "Limited" is enforced in the API, not by hiding the item: their report covers their own line (M12).

The top bar shows the current area, the bell and the account menu (name, role, sign out). The page itself carries its breadcrumb trail above the title (see [drill-down](#drill-down-follows-the-rollup-chain)).

**Hidden, not disabled.** A Senior does not see a greyed-out Sectors link — it is absent. A disabled control invites the question "how do I get access", which is not a conversation the product should start.

Hiding is convenience only; every hidden route independently fails at the API ([rbac-matrix](../01-product/rbac-matrix.md#enforcement)).

---

## The Junior's app has no navigation

Four screens, and three of them are reached from the first:

```
Route (home)
├─ Collection entry      tap a customer
├─ Sync status           tap the unsynced badge
└─ Notifications         tap the bell
```

No sidebar, no tab bar, no menu.

> A Junior is standing at a customer's door, one-handed, in sunlight. Navigation is a tax on the only task that matters. The route screen opens on launch and is where they return after every entry — the "back" action always goes to the route, and there is no deeper hierarchy to get lost in.
>
> This is a deliberate departure from §25's uniform nine-item navigation. Giving a Junior a Dashboard, Reports and Sectors menu would be nine ways to not be collecting.

**A persistent status bar** is fixed at the top of every Junior screen: online/offline indicator and unsynced count. It is the one piece of chrome, and it is there because "is my day safe" must be answerable without tapping anything.

---

## Admin console structure

```
Dashboard                    role-specific landing
Customers
├─ List (search, filter)
└─ Customer 360
   ├─ Profile + references
   ├─ Accounts (active, completed)
   └─ Collection history
Sectors
├─ List
└─ Sector detail → its lines
Lines
├─ List
└─ Line detail
   ├─ Overview (§14 figures)
   ├─ Staff
   ├─ Customers
   └─ Day closes
Collections
├─ List (filterable)
├─ Collection detail
└─ Pending approvals
Team
├─ Staff list
├─ Staff detail → assignment history
└─ Assignments
Notifications
Reports
├─ Line-wise · Investment · Collection · Overdue · Discrepancy
Settings                     Super Admin only
├─ Business settings
├─ Holidays
├─ Audit log
└─ Refused attempts
```

**Maximum three levels deep.** Anything deeper becomes a filter or a tab, not another level.

---

## Landing by role

| Role        | Lands on               | Because                                                        |
| ----------- | ---------------------- | -------------------------------------------------------------- |
| Super Admin | Business overview      | "How did we do today" is the question they open the app to ask |
| Admin       | Operational dashboard  | Today's work: new customers, pending approvals, problem lines  |
| Senior      | Their line's dashboard | Their entire scope is one line                                 |
| Junior      | Today's route          | Their entire job                                               |

---

## Drill-down follows the rollup chain

Every money figure descends along `Business → Sector → Line → Customer → Collection` (§23), and each level is a real screen with a stable URL — not a modal or an expanding row.

> A total that cannot be explained is a total that will not be trusted, and trust in the numbers is the entire point of replacing the spreadsheet. Real URLs mean a figure can be shared, bookmarked and returned to — which is what people do when they are checking something.

Every detail page shows that chain as a breadcrumb trail above its title (`PageTrail`): for example, Customers / Kumar Traders / ACC-0091, or Sectors / North / LN-07. Each level above the page is a link.

---

## Notifications

A bell with an unread count in the console header; in the Junior's status bar.

Opening shows the role-scoped list, grouped by day, categorised `ALERT` / `WARNING` / `SUCCESS` / `INFORMATION` (§24). Each deep-links to its subject — a low-collection alert opens that collection, not a filtered list.

---

## URLs

```
/dashboard            /dashboard/sectors    (sector comparison, Admin and above)
/customers            /customers/:id
/sectors              /sectors/:id
/lines                /lines/:id            /lines/:id/day-closes/:date
/collections          /collections/:id      /collections/pending-approval
/team                 /team/:id
/reports              /reports/line-wise    /reports/investment    /reports/collection    /reports/overdue    /reports/discrepancy    (the rest join as they are built)
/settings             /settings/holidays    /settings/audit    /settings/security

/route                            Junior home (S-01)
/route#collect/:customerId        entry (S-02), every account of that customer
/route#sync                       queue status (S-03)
/route#handover                   hand over cash (S-06, needs signal)

/cash                             handovers to acknowledge, cash for the office, day close picker
/lines/:lineId/day-closes/:date    day close (S-05)
```

Resource-oriented, bookmarkable, shareable.

### URL state

**A list's filters and a record's tab live in the query string**, so a reload, the back button or a shared link shows the same view. A filter at its default value is left out of the URL.

The page's server component reads them (`readListParams`), and the list keeps them in step (`useListState`).

| Page                   | Parameters                                                                  |
| ---------------------- | --------------------------------------------------------------------------- |
| `/dashboard/sectors`   | `date`. Blank means today                                                   |
| `/sectors`             | `inactive=show`                                                             |
| `/lines`               | `sectorId`, `inactive=show`                                                 |
| `/team`                | `role`, `status`                                                            |
| `/customers`           | `line`                                                                      |
| `/customers/:id`       | `tab` = `profile` or `accounts`                                             |
| `/collections`         | `from`, `to`, `line`, `show`. Blank dates mean the last seven days          |
| `/reports/line-wise`   | `from`, `to`, `sector`, `line`. Blank dates mean the month so far           |
| `/reports/investment`  | The same four, read by the same `report-parts.tsx`                          |
| `/reports/collection`  | The same four, plus `junior` and `classification`                           |
| `/reports/overdue`     | `sector`, `line`, `overdue` (7, 30 or 60 days), `sort`. No dates            |
| `/reports/discrepancy` | The four shared, plus `junior` and `show` (`all`; blank is not yet tallied) |
| `/cash`                | `line`, `date` (the day close to open)                                      |
| `/settings/audit`      | `action`, `entityTable`, `entityId`, `actorUserId`, `from`, `to`            |
| `/settings/security`   | `kind`, `code`, `actorUserId`, `from`, `to` — refused attempts (ADR-0014)   |
| `/settings`            | None. One list of settings — no filter, no tab (US-094)                     |

Paging is not in the URL. "Show more" follows the API's cursor, and a reload starts again from the first page.

**The Junior's routes are under `/route`** so the service worker scope covers exactly them and nothing else — the admin console carries no offline machinery it never uses ([offline-sync](../02-architecture/offline-sync.md#service-worker-scope)).

**The Junior's views are hashes of one page, not separate paths** (decision 2026-09-14). The service worker caches a page by its exact URL, so `/route/collect/:id` would open offline only for customers whose page happened to be visited with signal — most customers, at the door, would get a browser error. A hash never reaches the network: every view is the one cached `/route` document, reloads included. The phone's back button returns to the route, and opening one view from another replaces rather than stacks, so the route is never more than one step back. Entry is per customer rather than per account, because a customer with several accounts confirms each on one screen (BR-01a).

---

## Responsive behaviour

| Width      | Console                                                                                               |
| ---------- | ----------------------------------------------------------------------------------------------------- |
| ≥1280px    | Sidebar expanded, dense tables; the top bar's toggle pins it to the icon rail, remembered per browser |
| 768–1279px | Sidebar collapsed to icons, tables scroll horizontally                                                |
| <768px     | Sidebar becomes a drawer; tables become cards                                                         |

**The sidebar as built (2026-09-19, [ADR-0015](../02-architecture/adr/0015-console-layout-and-in-house-charts.md)).**

- **The current item.** It is a tab joined to the page. Its row takes the page's colour, with inverted corners above and below. It is the most specific matching link, so `/settings/audit` marks Audit log alone.
- **The rail.** It opens over the page, never pushing it, while the pointer is over it or keyboard focus is inside it. It shows no tooltips; the link names stay in the accessibility tree.
- **The top bar.** It is glass over the scrolling page. It holds:
  - the drawer button below 768px;
  - the rail toggle from 1280px (`aria-expanded`, `aria-controls`);
  - the area;
  - the bell as a round action with its unread count;
  - the account menu.

**The phone layout, chosen per device ([ADR-0016](../02-architecture/adr/0016-installable-app-and-per-device-layout.md)).** The table above is the computer layout, which a browser tab shows by default. Each device can instead choose the phone layout:

- an app bar holding the brand or a back arrow, the area, and the bell;
- a bottom tab bar with four tabs: the role's dashboard (Overview, Today or My line), Collections, Customers and Cash;
- "More", a bottom sheet listing every other area the role may see, then the layout switch, install and sign out.

Where the choice is made:

- installing Rasi from its account menu asks first;
- the installed app asks on its first launch when nothing has been chosen;
- either layout can switch at any time.

The Junior is never asked.

The Junior's app is **phone-only by design** — 360px is the design target, and it is not adapted upward for desktop because it is never used there.

Seniors use both: phone during the day for alerts and cash receipt, laptop in the evening for review.

---

## Empty and error states

Every list has a designed empty state that distinguishes three cases — **no data yet**, **no results for this filter**, and **nothing permitted here**. They need different words and different actions, and collapsing them into one "No results" is how a permission problem gets mistaken for a data problem.

The Junior's empty route is specific: Sunday, a declared holiday, and genuinely nothing due are three different messages.
