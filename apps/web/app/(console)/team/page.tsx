import type { Metadata } from "next";

import { TeamList } from "./team-list";

export const metadata: Metadata = { title: "Team · Rasi" };

/** S-14 staff list (US-014). A Senior sees their own line's team. */
export default function TeamPage() {
  return <TeamList />;
}
