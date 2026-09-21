"use client";

import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

import { TabLinks } from "../../../components/tab-links";
import { currentHref } from "../../../lib/nav";
import { settingsTabsFor } from "../../../lib/settings-tabs";
import { useSignedIn } from "../../../lib/use-me";

/**
 * The Settings group: one strip of tabs above whichever settings page is open
 * (navigation-ia.md#admin-console-structure). The tabs are links, so each part
 * keeps its own URL and its own filters.
 *
 * The page below brings its own `PageHeader` — the strip says which group this
 * is, the header says which page, and there is still one `h1`.
 */
export default function SettingsLayout({ children }: { children: ReactNode }) {
  const me = useSignedIn();
  const pathname = usePathname();
  const tabs = settingsTabsFor(me.role);

  return (
    <>
      <TabLinks
        label="Settings"
        tabs={tabs}
        current={currentHref(
          pathname,
          tabs.map((tab) => tab.href),
        )}
      />
      {children}
    </>
  );
}
