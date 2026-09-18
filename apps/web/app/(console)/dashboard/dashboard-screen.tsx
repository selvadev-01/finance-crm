"use client";

import { seesBusinessTotals } from "../../../lib/roles";
import { useSignedIn } from "../../../lib/use-me";
import { BusinessOverview } from "./business-overview";
import { DashboardPlaceholder } from "./dashboard-placeholder";
import { LineDashboard } from "./line-dashboard";
import { OperationsDashboard } from "./operations-dashboard";

/**
 * One landing, chosen by role (navigation-ia.md#landing): a Super Admin gets
 * the business overview (S-07, US-080); an Admin the operational dashboard
 * (S-20, US-082); a Senior their line's day (S-19, US-083). A Junior's
 * dashboard is the route, so they only reach the placeholder by typing the
 * address.
 */
export function DashboardScreen({ date }: { date: string | undefined }) {
  const me = useSignedIn();
  if (me.role === "SUPER_ADMIN") {
    return <BusinessOverview initial={date ? { date } : {}} />;
  }
  if (seesBusinessTotals(me.role)) return <OperationsDashboard date={date} />;
  if (me.role === "SENIOR") return <LineDashboard date={date} />;
  return <DashboardPlaceholder />;
}
