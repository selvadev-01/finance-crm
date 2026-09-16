import type { Metadata } from "next";

import { AuditLog, type AuditFilters } from "./audit-log";

export const metadata: Metadata = { title: "Audit log · Rasi" };

const FILTER_KEYS = [
  "action",
  "entityTable",
  "entityId",
  "actorUserId",
  "from",
  "to",
] as const;

/**
 * S-29 audit log (US-090), Admin and Super Admin. Filters live in the URL so a
 * notification or a colleague can link straight to the entries in question.
 */
export default async function AuditLogPage({
  searchParams,
}: PageProps<"/settings/audit">) {
  const params = await searchParams;
  const filters: AuditFilters = {};
  for (const key of FILTER_KEYS) {
    const value = params[key];
    if (typeof value === "string" && value !== "") filters[key] = value;
  }
  return <AuditLog initial={filters} />;
}
