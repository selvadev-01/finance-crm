import type { Metadata } from "next";

import { NotificationSettings } from "./notification-settings";

export const metadata: Metadata = { title: "Notification settings · Rasi" };

/**
 * M10 in the console: this device's push switch (US-071) and the reader's
 * notification categories (US-073). The notifications themselves open from the
 * bell, not from a page.
 */
export default function NotificationSettingsPage() {
  return <NotificationSettings />;
}
