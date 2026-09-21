import type { Metadata } from "next";

import { ProfileScreen } from "./profile-screen";

export const metadata: Metadata = { title: "My profile · Rasi" };

/**
 * S-32 · My profile (M01): the signed-in staff member's own record, their
 * password, and this device's layout. Opened from the account menu, never
 * from the sidebar — it is about the reader, not an area of the business.
 */
export default function ProfilePage() {
  return <ProfileScreen />;
}
