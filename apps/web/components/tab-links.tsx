"use client";

import { tabLinkClass, tabListClass } from "@repo/ui";
import Link from "next/link";

export interface TabLink {
  href: string;
  label: string;
}

/**
 * A group of pages switched between by link, wearing the tab strip
 * (`@repo/ui` `tabListClass` / `tabLinkClass`): Settings, whose parts are
 * separate URLs so a filter, an audit entry or a holiday can still be linked
 * to (navigation-ia.md#url-state).
 *
 * It is navigation, not `Tabs` — real `<a>`s in a `<nav>`, and the current one
 * is marked `aria-current="page"` rather than by a `data-state`. The tab whose
 * page the reader is on is still a link, so the browser's back button and
 * "open in new tab" behave as they do everywhere else.
 */
export function TabLinks({
  label,
  tabs,
  current,
}: {
  /** Names the group for a screen reader: "Settings". */
  label: string;
  tabs: readonly TabLink[];
  /** The `href` of the page being shown, if it is one of `tabs`. */
  current: string | undefined;
}) {
  return (
    <nav aria-label={label} className={tabListClass}>
      {tabs.map((tab) => (
        <Link
          key={tab.href}
          href={tab.href}
          aria-current={tab.href === current ? "page" : undefined}
          className={tabLinkClass}
        >
          {tab.label}
        </Link>
      ))}
    </nav>
  );
}
