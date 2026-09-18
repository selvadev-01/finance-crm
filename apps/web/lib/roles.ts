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

/**
 * Seniority, most senior first — the client half of the API's own rank rule
 * (US-092). A role may never create one above it, nor act on someone holding
 * one; the API refuses either way, this only keeps the button off the screen.
 */
const RANK: Record<Role, number> = {
  SUPER_ADMIN: 0,
  ADMIN: 1,
  SENIOR: 2,
  JUNIOR: 3,
};

/** `staff.create`: Admin and Super Admin. */
export function canCreateStaff(role: Role): boolean {
  return canManageOrganisation(role);
}

/** The roles this person may bring into existence: their own and below. */
export function creatableRoles(role: Role): Role[] {
  return (Object.keys(RANK) as Role[]).filter(
    (each) => RANK[each] >= RANK[role],
  );
}

/**
 * `staff.update` and `staff.suspend`, with the API's two extra rules: never
 * someone senior to you, and — for status — never yourself.
 */
export function canEditStaff(
  me: { role: Role },
  target: { role: Role },
): boolean {
  return canManageOrganisation(me.role) && RANK[target.role] >= RANK[me.role];
}

export function canChangeStatusOf(
  me: { role: Role; staffProfileId: string },
  target: { role: Role; staffProfileId: string },
): boolean {
  return (
    canEditStaff(me, target) && me.staffProfileId !== target.staffProfileId
  );
}

/** `staff.changeRole`: Super Admin only, and never their own role. */
export function canChangeRoleOf(
  me: { role: Role; staffProfileId: string },
  target: { staffProfileId: string },
): boolean {
  return (
    me.role === "SUPER_ADMIN" && me.staffProfileId !== target.staffProfileId
  );
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

/**
 * `settings.view` and `settings.change`: Super Admin alone (M15, US-094).
 * Settings alter how the system behaves for everyone, so changing one is not
 * an operational act — the API refuses every other role at both routes.
 */
export function seesSettings(role: Role): boolean {
  return role === "SUPER_ADMIN";
}

/** Only Seniors and Juniors work lines (M03). */
export function worksLines(role: Role): role is "SENIOR" | "JUNIOR" {
  return role === "SENIOR" || role === "JUNIOR";
}
