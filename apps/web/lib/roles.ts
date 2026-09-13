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

/** Only Seniors and Juniors work lines (M03). */
export function worksLines(role: Role): role is "SENIOR" | "JUNIOR" {
  return role === "SENIOR" || role === "JUNIOR";
}
