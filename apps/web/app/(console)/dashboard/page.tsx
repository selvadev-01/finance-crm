import { isCalendarDate } from "@repo/domain";
import type { Metadata } from "next";

import { readListParams } from "../../../lib/list-params";
import { DashboardScreen } from "./dashboard-screen";

export const metadata: Metadata = { title: "Dashboard · Rasi" };

/**
 * The console landing. Super Admin: the business overview (S-07, US-080);
 * Admin: the operational dashboard (S-20, US-082); Senior: their line (S-19,
 * US-083) — each for `?date=` or today.
 */
export default async function DashboardPage({
  searchParams,
}: PageProps<"/dashboard">) {
  const { date } = readListParams(await searchParams, ["date"]);
  // A date that is not a real day is ignored rather than failing the page.
  return (
    <DashboardScreen
      date={date !== undefined && isCalendarDate(date) ? date : undefined}
    />
  );
}
