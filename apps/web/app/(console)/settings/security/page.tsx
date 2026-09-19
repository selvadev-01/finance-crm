import type { Metadata } from "next";

import { readListParams } from "../../../../lib/list-params";
import { SecurityEvents } from "./security-events";

export const metadata: Metadata = { title: "Refused attempts · Rasi" };

const FILTER_KEYS = ["kind", "code", "actorUserId", "from", "to"] as const;

/**
 * S-31 refused attempts, Admin and Super Admin — the same roles the
 * audit log is for, and for the same reason (rbac-matrix.md). Filters live in
 * the URL so one attempt can be linked to.
 */
export default async function SecurityEventsPage({
  searchParams,
}: PageProps<"/settings/security">) {
  return (
    <SecurityEvents initial={readListParams(await searchParams, FILTER_KEYS)} />
  );
}
