import type { StaffRole } from '@repo/db';

/**
 * The action half of the RBAC matrix (M02, docs/01-product/rbac-matrix.md):
 * which roles may perform each operation **at all**.
 *
 * "own line" and "own assigned" cells are allowed here; *which rows* is the
 * other half, decided by the scope predicates in `scope.ts`. A denied cell (`—`)
 * is a role missing from the list, and answers `403`.
 *
 * `permissions.spec.ts` parses the matrix document and fails if this map and
 * the document disagree — change both together.
 */
const ALL: readonly StaffRole[] = ['SUPER_ADMIN', 'ADMIN', 'SENIOR', 'JUNIOR'];
const ADMINS: readonly StaffRole[] = ['SUPER_ADMIN', 'ADMIN'];
const ADMINS_AND_SENIOR: readonly StaffRole[] = [...ADMINS, 'SENIOR'];
const SUPER_ADMIN: readonly StaffRole[] = ['SUPER_ADMIN'];

export const PERMISSIONS = {
  // Customers (M04)
  'customer.view': ALL,
  'customer.create': ADMINS,
  'customer.update': ADMINS,
  'customer.changeLine': ADMINS,
  'customer.delete': SUPER_ADMIN,
  'customer.viewReferences': ALL,

  // Accounts (M05)
  'account.view': ALL,
  'account.create': ADMINS,
  'account.disburse': ADMINS,
  'account.updateTerms': ADMINS,
  'account.close': SUPER_ADMIN,
  'account.viewSchedule': ALL,

  // Collections (M07) — only Juniors record: cash changed hands at their door.
  'collection.record': ['JUNIOR'],
  'collection.view': ALL,
  'collection.requestCorrection': ['SENIOR', 'JUNIOR'],
  'collection.approveCorrection': ADMINS_AND_SENIOR,
  'collection.reverse': ADMINS,

  // Day close and cash (M08)
  'dayClose.view': ADMINS_AND_SENIOR,
  'dayClose.close': ADMINS_AND_SENIOR,
  'dayClose.reopen': ADMINS,
  'handover.initiate': ['SENIOR', 'JUNIOR'],
  'handover.acknowledge': ADMINS_AND_SENIOR,
  'handover.dispute': ALL,
  'handover.recordDenominations': ['SENIOR', 'JUNIOR'],

  // Organisation (M03)
  'organisation.view': ALL,
  'sector.manage': ADMINS,
  'line.manage': ADMINS,
  'assignment.assignSenior': ADMINS,
  'assignment.moveJunior': ADMINS,
  'assignment.viewHistory': ADMINS_AND_SENIOR,

  // Money visibility (M09, M11, M12) — Juniors never see profit or investment.
  'money.businessTotals': ADMINS,
  'money.sectorTotals': ADMINS,
  'money.lineTotals': ADMINS_AND_SENIOR,
  'money.investedAmount': ADMINS_AND_SENIOR,
  'money.profit': ADMINS_AND_SENIOR,
  'money.outstanding': ALL,
  'ledger.view': ADMINS,
  'report.view': ADMINS_AND_SENIOR,

  // Notifications (M10)
  'notification.viewOwn': ALL,
  'notification.registerDevice': ALL,
  'notification.managePreferences': ALL,

  // Administration (M01, M13, M15)
  'staff.list': ADMINS_AND_SENIOR,
  'staff.create': ADMINS,
  'staff.changeRole': SUPER_ADMIN,
  'staff.suspend': ADMINS,
  'staff.resetPassword': ADMINS,
  'audit.view': ADMINS,
  'settings.change': SUPER_ADMIN,
  'holiday.declare': ADMINS,
  'profile.viewOwn': ALL,
} as const satisfies Record<string, readonly StaffRole[]>;

export type Permission = keyof typeof PERMISSIONS;

export function roleHasPermission(
  role: StaffRole,
  permission: Permission,
): boolean {
  return (PERMISSIONS[permission] as readonly StaffRole[]).includes(role);
}
