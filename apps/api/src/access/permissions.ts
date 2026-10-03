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
  // A Senior onboards customers onto their own lines (decided 2026-10-03);
  // `lineScope` refuses any other line as missing.
  'customer.create': ADMINS_AND_SENIOR,
  'customer.update': ADMINS,
  'customer.changeLine': ADMINS,
  'customer.delete': SUPER_ADMIN,
  'customer.viewReferences': ALL,

  // Accounts (M05)
  'account.view': ALL,
  // A Senior opens accounts for customers on their own lines; theirs wait
  // for `account.approve` before the Super Admin disburses (decided
  // 2026-10-03).
  'account.create': ADMINS_AND_SENIOR,
  'account.approve': ADMINS,
  'account.disburse': SUPER_ADMIN,
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
  // US-032: money the owner puts in funds office cash — the owner's act alone.
  'capital.add': SUPER_ADMIN,

  // Books (ADR-0018): the business's own money beside the loan book.
  'expense.view': ALL,
  'expense.record': ADMINS,
  'expense.requestField': ['SENIOR', 'JUNIOR'],
  'expense.approve': ADMINS_AND_SENIOR,
  'expenseCategory.manage': SUPER_ADMIN,
  'bank.manage': SUPER_ADMIN,
  'bank.transfer': ADMINS,
  'income.record': ADMINS,
  'drawings.record': SUPER_ADMIN,
  'journal.post': SUPER_ADMIN,

  // Organisation (M03)
  'organisation.view': ALL,
  'sector.manage': ADMINS,
  'line.manage': ADMINS,
  'assignment.assignSenior': ADMINS,
  'assignment.moveJunior': ADMINS,
  // Staff may work several lines (decided 2026-10-03), so leaving one is its
  // own act rather than a side effect of being assigned elsewhere.
  'assignment.end': ADMINS,
  'assignment.viewHistory': ADMINS_AND_SENIOR,
  'line.setVisitingOrder': ADMINS_AND_SENIOR,

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
  // US-074: the words and channels of every message are how the business
  // speaks to its staff — the owner's alone, like the settings.
  'notificationTemplate.view': SUPER_ADMIN,
  'notificationTemplate.manage': SUPER_ADMIN,

  // Administration (M01, M13, M15)
  'staff.list': ADMINS_AND_SENIOR,
  'staff.create': ADMINS,
  'staff.update': ADMINS,
  'staff.changeRole': SUPER_ADMIN,
  'staff.suspend': ADMINS,
  'staff.resetPassword': ADMINS,
  'staff.delete': ADMINS,
  'audit.view': ADMINS,
  // M14: whether the scheduled jobs ran. Read-only; there is no replay.
  'job.view': ADMINS,
  // Reading the settings shows how the business behaves; changing one alters
  // it for everyone (M15). Both are the owner's alone.
  'settings.view': SUPER_ADMIN,
  'settings.change': SUPER_ADMIN,
  // Declaring and removing a future holiday are one permission (M06, US-093).
  'holiday.view': ALL,
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
