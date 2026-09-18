import type { Metadata } from "next";

import { readListParams } from "../../../../lib/list-params";
import { HolidayList } from "./holiday-list";

export const metadata: Metadata = { title: "Holidays · Rasi" };

/**
 * S-27 holidays (US-093). Every console role reads the list (M06); only
 * Admins and Super Admins declare or remove, and only future dates.
 */
export default async function HolidaysPage({
  searchParams,
}: PageProps<"/settings/holidays">) {
  return (
    <HolidayList initial={readListParams(await searchParams, ["period"])} />
  );
}
