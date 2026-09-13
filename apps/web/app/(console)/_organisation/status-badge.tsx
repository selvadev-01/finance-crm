import { Badge } from "@repo/ui";

/** Active or inactive — a sector or line is never deleted (M03). */
export function StatusBadge({ isActive }: { isActive: boolean }) {
  return isActive ? (
    <Badge tone="positive">Active</Badge>
  ) : (
    <Badge tone="neutral">Inactive</Badge>
  );
}
