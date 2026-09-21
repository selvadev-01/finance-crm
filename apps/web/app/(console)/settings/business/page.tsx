import type { Metadata } from "next";

import { BusinessSettingsScreen } from "./business-settings";

export const metadata: Metadata = { title: "Business settings · Rasi" };

/**
 * S-28 business settings (US-094). Super Admin only (M15); the API refuses
 * every other role at both routes, and the screen shows that refusal rather
 * than pretending the page does not exist.
 *
 * No URL state: the page is one tab of Settings, with no filter of its own.
 */
export default function BusinessSettingsPage() {
  return <BusinessSettingsScreen />;
}
