import type { Metadata } from "next";

import { DashboardPlaceholder } from "./dashboard-placeholder";

export const metadata: Metadata = { title: "Dashboard · Rasi" };

/**
 * The console landing for Super Admin (S-07), Admin (S-20) and Senior (S-19).
 * Its figures come from collections and the ledger, which are not built, so it
 * says so rather than showing zeros (S-07: a zero and an unknown differ).
 */
export default function DashboardPage() {
  return <DashboardPlaceholder />;
}
