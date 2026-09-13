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
└─ Audit log
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

---

## Notifications

A bell with an unread count in the console header; in the Junior's status bar.

Opening shows the role-scoped list, grouped by day, categorised `ALERT` / `WARNING` / `SUCCESS` / `INFORMATION` (§24). Each deep-links to its subject — a low-collection alert opens that collection, not a filtered list.

---

## URLs

```
/dashboard
/customers            /customers/:id
/sectors              /sectors/:id
/lines                /lines/:id            /lines/:id/day-closes/:date
/collections          /collections/:id      /collections/pending-approval
/team                 /team/:id
/reports/line-wise    /reports/overdue
/settings/holidays    /settings/audit

/route                            Junior home
/route/collect/:accountLoanId     entry
/route/sync                       queue status
```

Resource-oriented, bookmarkable, shareable. **The Junior's routes are under `/route`** so the service worker scope covers exactly them and nothing else — the admin console carries no offline machinery it never uses ([offline-sync](../02-architecture/offline-sync.md#service-worker-scope)).

---

## Responsive behaviour

| Width      | Console                                                |
| ---------- | ------------------------------------------------------ |
| ≥1280px    | Sidebar expanded, dense tables                         |
| 768–1279px | Sidebar collapsed to icons, tables scroll horizontally |
| <768px     | Sidebar becomes a drawer; tables become cards          |

The Junior's app is **phone-only by design** — 360px is the design target, and it is not adapted upward for desktop because it is never used there.

Seniors use both: phone during the day for alerts and cash receipt, laptop in the evening for review.

---

## Empty and error states

Every list has a designed empty state that distinguishes three cases — **no data yet**, **no results for this filter**, and **nothing permitted here**. They need different words and different actions, and collapsing them into one "No results" is how a permission problem gets mistaken for a data problem.

The Junior's empty route is specific: Sunday, a declared holiday, and genuinely nothing due are three different messages.
