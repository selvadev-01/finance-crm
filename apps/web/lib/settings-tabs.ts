import type { TabLink } from "../components/tab-links";
import { canManageOrganisation, type Role, seesSettings } from "./roles";

const everyone = () => true;

export interface SettingsTab extends TabLink {
  shownTo: (role: Role) => boolean;
}

/**
 * The Settings group (navigation-ia.md#admin-console-structure): one sidebar
 * item, and its parts as tabs. Each part keeps a URL of its own, because the
 * audit log and the refused attempts hold their filters there and a holiday or
 * an entry has to be linkable (navigation-ia.md#url-state) — so these are
 * links wearing a tab strip, not `Tabs`.
 *
 * The business first, then the calendar everyone reads, then the reader's own
 * notifications, then the record of what happened. A role sees only the tabs
 * it may open; the API refuses the rest whatever the strip shows.
 */
export const SETTINGS_TABS: SettingsTab[] = [
  // M15, US-094: the Super Admin's alone.
  { href: "/settings/business", label: "Business", shownTo: seesSettings },
  // M06, US-093: every console role reads the holidays.
  { href: "/settings/holidays", label: "Holidays", shownTo: everyone },
  // M10, US-071 and US-073: the reader's own categories and this device.
  {
    href: "/settings/notifications",
    label: "Notifications",
    shownTo: everyone,
  },
  // M13, US-090 and ADR-0014: Admin and above.
  {
    href: "/settings/audit",
    label: "Audit log",
    shownTo: canManageOrganisation,
  },
  {
    href: "/settings/security",
    label: "Refused attempts",
    shownTo: canManageOrganisation,
  },
];

/** The tabs this role may open, in order. */
export function settingsTabsFor(role: Role): TabLink[] {
  return SETTINGS_TABS.filter((tab) => tab.shownTo(role)).map(
    ({ href, label }) => ({ href, label }),
  );
}

/**
 * Where `/settings` sends this role: their first tab. A Super Admin lands on
 * the business settings, everyone else on the holidays — `/settings` itself
 * holds nothing, so landing on a refusal would be the wrong answer to a
 * sidebar item every role is shown.
 */
export function firstSettingsTab(role: Role): string {
  const first = settingsTabsFor(role)[0];
  if (!first) throw new Error(`No settings tab for ${role}`);
  return first.href;
}
