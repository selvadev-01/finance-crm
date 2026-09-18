import type { Metadata } from "next";

import { readListParams } from "../../../../lib/list-params";
import { AuditLog } from "./audit-log";

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
  return <AuditLog initial={readListParams(await searchParams, FILTER_KEYS)} />;
}
