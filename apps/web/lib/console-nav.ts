import {
  AddressBook,
  BookOpenText,
  ChartBar,
  House,
  MapTrifold,
  Money,
  Path,
  Receipt,
  SlidersHorizontal,
  SquaresFour,
  UsersThree,
} from "@phosphor-icons/react/dist/ssr";

import { canManageOrganisation, type Role, seesReports } from "./roles";

export interface NavItem {
  href: string;
  label: string;
  icon: typeof SquaresFour;
  shownTo: (role: Role) => boolean;
}

export interface NavGroup {
  title: string;
  items: NavItem[];
}

const everyone = () => true;

/**
 * navigation-ia.md#navigation-by-role — only the areas that exist so far,
 * grouped by what a person is doing: running today's money, looking after the
 * records, or the system itself. A link to an unbuilt page is not added early.
 * Hidden, not disabled: a role without the area does not see the link.
 */
export const NAV: NavGroup[] = [
  {
    title: "Operate",
    items: [
      {
        href: "/dashboard",
        label: "Dashboard",
        icon: SquaresFour,
        shownTo: everyone,
      },
      {
        href: "/collections",
        label: "Collections",
        icon: Receipt,
        shownTo: everyone,
      },
      { href: "/cash", label: "Cash", icon: Money, shownTo: everyone },
      // M12: Admins, and a Senior for their own line (US-084 onwards).
      {
        href: "/reports",
        label: "Reports",
        icon: ChartBar,
        shownTo: seesReports,
      },
      // ADR-0018: the business's own money — Admins and above.
      {
        href: "/books",
        label: "Books",
        icon: BookOpenText,
        shownTo: canManageOrganisation,
      },
    ],
  },
  {
    title: "Records",
    items: [
      {
        href: "/customers",
        label: "Customers",
        icon: AddressBook,
        shownTo: everyone,
      },
      { href: "/lines", label: "Lines", icon: Path, shownTo: everyone },
      {
        href: "/sectors",
        label: "Sectors",
        icon: MapTrifold,
        shownTo: canManageOrganisation,
      },
      { href: "/team", label: "Team", icon: UsersThree, shownTo: everyone },
    ],
  },
  {
    title: "System",
    items: [
      /**
       * One item for the whole Settings group; its parts — business settings,
       * holidays, notifications, the audit log and the refused attempts — are
       * tabs within it (`settings-tabs.ts`). Which tabs a role sees, and which
       * one `/settings` opens on, is decided there.
       */
      {
        href: "/settings",
        label: "Settings",
        icon: SlidersHorizontal,
        shownTo: everyone,
      },
    ],
  },
];

/** The navigation this role may see, empty groups dropped. */
export function navFor(role: Role): NavGroup[] {
  return NAV.map((group) => ({
    ...group,
    items: group.items.filter((item) => item.shownTo(role)),
  })).filter((group) => group.items.length > 0);
}

/**
 * The phone layout's four tabs per role, in order; everything else is under
 * "More". The Stitch screens in "Rasi Mobile, all roles" (2026-10-02) shape
 * each bar for the work: the owner's books, the Admin's cash, the Senior's
 * cash before their customers.
 */
export const TAB_HREFS: Record<Exclude<Role, "JUNIOR">, readonly string[]> = {
  SUPER_ADMIN: ["/dashboard", "/collections", "/customers", "/books"],
  ADMIN: ["/dashboard", "/collections", "/customers", "/cash"],
  SENIOR: ["/dashboard", "/collections", "/cash", "/customers"],
};

/** The phone layout for a role: its tabs, and the groups under "More". */
export function mobileNav(role: Exclude<Role, "JUNIOR">): {
  tabs: NavItem[];
  more: NavGroup[];
} {
  const groups = navFor(role);
  const items = groups.flatMap((group) => group.items);
  const hrefs = TAB_HREFS[role];
  const tabs = hrefs.flatMap((href) => {
    const item = items.find((each) => each.href === href);
    if (!item) return [];
    // Every role's home is "Home", with a house (the designs' first tab).
    return [
      href === "/dashboard" ? { ...item, label: "Home", icon: House } : item,
    ];
  });
  const isTab = (item: NavItem) => hrefs.includes(item.href);
  const more = groups
    .map((group) => ({
      ...group,
      items: group.items.filter((item) => !isTab(item)),
    }))
    .filter((group) => group.items.length > 0);
  return { tabs, more };
}
