import {
  AddressBook,
  ArrowsLeftRight,
  BookOpenText,
  CalendarBlank,
  ChartBar,
  ClockCounterClockwise,
  HandCoins,
  LockKey,
  MapTrifold,
  Money,
  Path,
  Receipt,
  Scales,
  SlidersHorizontal,
  TrendUp,
  UsersThree,
} from "@phosphor-icons/react/dist/ssr";

import {
  canManageOrganisation,
  type Role,
  seesReports,
  seesSettings,
} from "./roles";

/**
 * The phone home's menu (Stitch "Rasi Mobile, all roles", 2026-10-02): a grid
 * of tiles, one per place a role works. Like the console's navigation, a tile
 * a role may not use is absent, never greyed out — and the API refuses the
 * route regardless, so this is wayfinding, not access control.
 *
 * Every tile is a page that exists. `href` may be a function of the Senior's
 * line, for the tiles that open that line's own pages.
 */
export type ConsoleRole = Exclude<Role, "JUNIOR">;

/** A count shown on a tile, filled in by the page that has read it. */
export type MenuBadge = "approvals" | "handovers" | "expenses";

export interface MenuTile {
  key: string;
  label: string;
  icon: typeof Receipt;
  /** Null when the tile has nowhere to go for this person (a Senior with no line). */
  href: (context: MenuContext) => string | null;
  shownTo: (role: ConsoleRole) => boolean;
  badge?: MenuBadge;
}

export interface MenuContext {
  /** The Senior's line and the date shown, for their day close. */
  line: { lineId: string; businessDate: string } | null;
}

const everyone = () => true;
const senior = (role: ConsoleRole) => role === "SENIOR";
const books = canManageOrganisation;

const dayClose = ({ line }: MenuContext) =>
  line ? `/lines/${line.lineId}/day-closes/${line.businessDate}` : null;

const TILES: MenuTile[] = [
  {
    key: "collections",
    label: "Collections",
    icon: Receipt,
    href: () => "/collections",
    shownTo: everyone,
  },
  {
    key: "approvals",
    label: "Approvals",
    icon: ArrowsLeftRight,
    href: () => "/collections/pending-approval",
    shownTo: everyone,
    badge: "approvals",
  },
  {
    key: "handovers",
    label: "Handovers",
    icon: HandCoins,
    href: dayClose,
    shownTo: senior,
    badge: "handovers",
  },
  {
    key: "day-close",
    label: "Day close",
    icon: LockKey,
    href: dayClose,
    shownTo: senior,
  },
  {
    key: "customers",
    label: "Customers",
    icon: AddressBook,
    href: () => "/customers",
    shownTo: everyone,
  },
  {
    key: "cash",
    label: "Cash",
    icon: Money,
    href: () => "/cash",
    shownTo: everyone,
  },
  {
    key: "lines",
    label: "Lines",
    icon: Path,
    href: () => "/lines",
    shownTo: everyone,
  },
  {
    key: "sectors",
    label: "Sectors",
    icon: MapTrifold,
    href: () => "/sectors",
    shownTo: canManageOrganisation,
  },
  {
    key: "team",
    label: "Team",
    icon: UsersThree,
    href: () => "/team",
    shownTo: everyone,
  },
  {
    key: "books",
    label: "Ledger",
    icon: BookOpenText,
    href: () => "/books",
    shownTo: books,
  },
  {
    key: "expenses",
    label: "Expenses",
    icon: Receipt,
    href: () => "/books/expenses",
    shownTo: books,
    badge: "expenses",
  },
  {
    key: "balance-sheet",
    label: "Balance sheet",
    icon: Scales,
    href: () => "/books/balance-sheet",
    shownTo: seesSettings,
  },
  {
    key: "profit-and-loss",
    label: "Profit & loss",
    icon: TrendUp,
    href: () => "/books/profit-and-loss",
    shownTo: seesSettings,
  },
  {
    key: "reports",
    label: "Reports",
    icon: ChartBar,
    href: () => "/reports",
    shownTo: seesReports,
  },
  {
    key: "holidays",
    label: "Holidays",
    icon: CalendarBlank,
    href: () => "/settings/holidays",
    shownTo: everyone,
  },
  {
    key: "audit",
    label: "Audit log",
    icon: ClockCounterClockwise,
    href: () => "/settings/audit",
    shownTo: canManageOrganisation,
  },
  {
    key: "settings",
    label: "Settings",
    icon: SlidersHorizontal,
    href: () => "/settings",
    shownTo: seesSettings,
  },
];

export interface HomeMenuItem {
  key: string;
  label: string;
  icon: typeof Receipt;
  href: string;
  badge?: MenuBadge;
}

/** The tiles this role sees, in order, each with where it goes. */
export function homeMenu(
  role: ConsoleRole,
  context: MenuContext,
): HomeMenuItem[] {
  return TILES.filter((tile) => tile.shownTo(role)).flatMap((tile) => {
    const href = tile.href(context);
    if (href === null) return [];
    return [
      {
        key: tile.key,
        label: tile.label,
        icon: tile.icon,
        href,
        ...(tile.badge ? { badge: tile.badge } : {}),
      },
    ];
  });
}
