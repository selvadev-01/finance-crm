import type { StaffSummary } from "@repo/contracts";
import { Badge } from "@repo/ui";

import { ROLE_LABEL } from "../../../lib/roles";

/** ACTIVE may sign in; SUSPENDED and INACTIVE may not (M01). */
export function StaffStatusBadge({ status }: { status: StaffSummary["status"] }) {
  if (status === "ACTIVE") return <Badge tone="positive">Active</Badge>;
  if (status === "SUSPENDED") return <Badge tone="warning">Suspended</Badge>;
  return <Badge tone="neutral">Inactive</Badge>;
}

export function roleLabel(role: StaffSummary["role"]): string {
  return ROLE_LABEL[role];
}
