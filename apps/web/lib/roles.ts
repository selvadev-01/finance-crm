import type { Me } from "@repo/contracts";

/**
 * What a role is shown. Convenience only, so a Senior is not offered a button
 * that would answer `403` — every one of these is refused again by the API
 * (rbac-matrix.md#enforcement). Mirrors `apps/api/src/access/permissions.ts`.
 */
export type Role = Me["role"];

export const ROLE_LABEL: Record<Role, string> = {
  SUPER_ADMIN: "Super Admin",
  ADMIN: "Admin",
  SENIOR: "Senior",
  JUNIOR: "Junior",
};

/**
 * `sector.manage`, `line.manage`, `assignment.assignSenior`,
 * `assignment.moveJunior`, `staff.resetPassword`: Admin and Super Admin.
 */
export function canManageOrganisation(role: Role): boolean {
  return role === "SUPER_ADMIN" || role === "ADMIN";
}

/**
 * Whether the reset action is offered for `target`. The API also refuses a
 * reset of yourself (use change-password) and an Admin resetting a Super Admin.
 */
export function canResetPasswordOf(
  me: { role: Role; staffProfileId: string },
  target: { role: Role; staffProfileId: string },
): boolean {
  if (!canManageOrganisation(me.role)) return false;
  if (me.staffProfileId === target.staffProfileId) return false;
  return target.role !== "SUPER_ADMIN" || me.role === "SUPER_ADMIN";
}

/** `customer.create` and `account.create`: Admin and Super Admin. */
export function canOnboard(role: Role): boolean {
  return role === "SUPER_ADMIN" || role === "ADMIN";
}

/**
 * `money.businessTotals`: the business-wide dashboards — the overview (US-080)
 * and the operational dashboard (US-082). Which one lands is the role's
 * choice in `dashboard-screen.tsx`.
 */
export function seesBusinessTotals(role: Role): boolean {
  return role === "SUPER_ADMIN" || role === "ADMIN";
}

/** `money.sectorTotals`: the sector comparison (US-081). */
export function seesSectorTotals(role: Role): boolean {
  return role === "SUPER_ADMIN" || role === "ADMIN";
}

/**
 * `report.view`: the reports (M12) — Super Admin and Admin across the
 * business, a Senior for their own line.
 */
export function seesReports(role: Role): boolean {
  return role === "SUPER_ADMIN" || role === "ADMIN" || role === "SENIOR";
}

/** Only Seniors and Juniors work lines (M03). */
export function worksLines(role: Role): role is "SENIOR" | "JUNIOR" {
  return role === "SENIOR" || role === "JUNIOR";
}
