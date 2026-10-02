import type { Metadata } from "next";

import { readListParams } from "../../../../lib/list-params";
import { TrialBalanceReport } from "./trial-balance-report";

export const metadata: Metadata = { title: "Trial balance · Rasi" };

/** M09 trial balance, as of `?date=` or today. Admins and Super Admins. */
export default async function TrialBalancePage({
  searchParams,
}: PageProps<"/reports/trial-balance">) {
  return (
    <TrialBalanceReport
      initial={readListParams(await searchParams, ["date"])}
    />
  );
}
