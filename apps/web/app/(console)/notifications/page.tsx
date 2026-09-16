import type { Metadata } from "next";

import { NotificationCentre } from "./notification-centre";

export const metadata: Metadata = { title: "Notifications · Rasi" };

/** M10 in the console: the notification centre and its settings (US-070, US-071, US-073). */
export default function NotificationsPage() {
  return <NotificationCentre />;
}
