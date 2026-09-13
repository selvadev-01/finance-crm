import type { Metadata } from "next";

import { StaffDetailView } from "./staff-detail";

export const metadata: Metadata = { title: "Staff · Rasi" };

/** S-14 staff detail → assignment history; S-15 assign; US-003 reset. */
export default async function StaffPage({
  params,
}: PageProps<"/team/[staffProfileId]">) {
  const { staffProfileId } = await params;
  return <StaffDetailView staffProfileId={staffProfileId} />;
}
