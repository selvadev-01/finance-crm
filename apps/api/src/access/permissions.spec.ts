import { readFileSync } from 'node:fs';

import type { StaffRole } from '@repo/db';

import {
  type Permission,
  PERMISSIONS,
  roleHasPermission,
} from './permissions.js';

/**
 * The permission map must say exactly what the RBAC matrix document says.
 * Parsing the document means a change to either without the other fails here,
 * rather than surfacing as a role that can do something the business ruled out.
 */
const ROLES: StaffRole[] = ['SUPER_ADMIN', 'ADMIN', 'SENIOR', 'JUNIOR'];

/** Matrix row label (section › action) → permission. `null` rows are not permissions. */
const ROW_PERMISSIONS: Record<string, Permission | null> = {
  'Customers (M04) › List / view': 'customer.view',
  'Customers (M04) › Create': 'customer.create',
  'Customers (M04) › Update': 'customer.update',
  'Customers (M04) › Change line': 'customer.changeLine',
  'Customers (M04) › Soft delete': 'customer.delete',
  'Customers (M04) › View references': 'customer.viewReferences',
  'Accounts (M05) › List / view': 'account.view',
  'Accounts (M05) › Create': 'account.create',
  'Accounts (M05) › Disburse': 'account.disburse',
  'Accounts (M05) › Update terms (pre-disbursement)': 'account.updateTerms',
  'Accounts (M05) › Mark `DEFAULTED` / `WRITTEN_OFF`': 'account.close',
  'Accounts (M05) › View schedule': 'account.viewSchedule',
  'Collections (M07) › Record collection': 'collection.record',
  'Collections (M07) › View': 'collection.view',
  'Collections (M07) › Request correction': 'collection.requestCorrection',
  'Collections (M07) › Approve correction': 'collection.approveCorrection',
  'Collections (M07) › Reverse a collection': 'collection.reverse',
  'Day close and cash (M08) › View day close': 'dayClose.view',
  'Day close and cash (M08) › Close day': 'dayClose.close',
  'Day close and cash (M08) › Reopen day (manual)': 'dayClose.reopen',
  'Day close and cash (M08) › Initiate handover': 'handover.initiate',
  'Day close and cash (M08) › Acknowledge handover': 'handover.acknowledge',
  'Day close and cash (M08) › Dispute handover': 'handover.dispute',
  'Day close and cash (M08) › Record denominations':
    'handover.recordDenominations',
  'Organisation (M03) › View sectors / lines': 'organisation.view',
  'Organisation (M03) › Create / update sector': 'sector.manage',
  'Organisation (M03) › Create / update line': 'line.manage',
  'Organisation (M03) › Assign Senior to line': 'assignment.assignSenior',
  'Organisation (M03) › Assign / move Junior': 'assignment.moveJunior',
  'Organisation (M03) › View assignment history': 'assignment.viewHistory',
  'Organisation (M03) › Set visiting order': 'line.setVisitingOrder',
  'Money visibility (M09, M11, M12) › Business totals': 'money.businessTotals',
  'Money visibility (M09, M11, M12) › Sector totals': 'money.sectorTotals',
  'Money visibility (M09, M11, M12) › Line totals': 'money.lineTotals',
  'Money visibility (M09, M11, M12) › Invested amount': 'money.investedAmount',
  'Money visibility (M09, M11, M12) › Profit': 'money.profit',
  'Money visibility (M09, M11, M12) › Outstanding per account':
    'money.outstanding',
  'Money visibility (M09, M11, M12) › Ledger entries': 'ledger.view',
  'Money visibility (M09, M11, M12) › Reports': 'report.view',
  'Notifications (M10) › View own notifications': 'notification.viewOwn',
  'Notifications (M10) › Scope received': null,
  'Notifications (M10) › Register push device': 'notification.registerDevice',
  'Notifications (M10) › Manage preferences': 'notification.managePreferences',
  'Administration (M01, M13, M15) › List staff': 'staff.list',
  'Administration (M01, M13, M15) › Create staff': 'staff.create',
  'Administration (M01, M13, M15) › Update staff details': 'staff.update',
  'Administration (M01, M13, M15) › Change staff role': 'staff.changeRole',
  'Administration (M01, M13, M15) › Suspend staff': 'staff.suspend',
  'Administration (M01, M13, M15) › Delete staff (soft)': 'staff.delete',
  "Administration (M01, M13, M15) › Reset another's password":
    'staff.resetPassword',
  'Administration (M01, M13, M15) › View audit log': 'audit.view',
  "Administration (M01, M13, M15) › View an account's history": 'audit.view',
  'Administration (M01, M13, M15) › View settings': 'settings.view',
  'Administration (M01, M13, M15) › Change settings': 'settings.change',
  'Administration (M01, M13, M15) › View holidays': 'holiday.view',
  'Administration (M01, M13, M15) › Declare holiday': 'holiday.declare',
  'Administration (M01, M13, M15) › Remove a future holiday': 'holiday.declare',
  'Administration (M01, M13, M15) › View own profile': 'profile.viewOwn',
};

interface MatrixRow {
  label: string;
  cells: string[];
}

function readMatrix(): MatrixRow[] {
  const markdown = readFileSync(
    new URL('../../../../docs/01-product/rbac-matrix.md', import.meta.url),
    'utf8',
  );
  const actionMatrix = markdown.split('## Action matrix')[1]?.split('\n## ')[0];
  if (!actionMatrix)
    throw new Error('rbac-matrix.md has no "## Action matrix" section');

  const rows: MatrixRow[] = [];
  let section = '';
  for (const line of actionMatrix.split('\n')) {
    const heading = /^### (.+)$/.exec(line);
    if (heading?.[1]) {
      section = heading[1].trim();
      continue;
    }
    if (!line.startsWith('|')) continue;
    const cells = line
      .split('|')
      .slice(1, -1)
      .map((cell) => cell.replaceAll('**', '').trim());
    const [label, ...roleCells] = cells;
    if (!label || label === 'Action' || label === 'Data' || /^:?-+/.test(label))
      continue;
    rows.push({ label: `${section} › ${label}`, cells: roleCells });
  }
  return rows;
}

describe('permission map (M02)', () => {
  const rows = readMatrix();

  it('the matrix document parses into rows for every section', () => {
    expect(rows.length).toBeGreaterThan(40);
  });

  it('every matrix row is mapped, so a new row cannot be silently ignored', () => {
    const unmapped = rows
      .map((row) => row.label)
      .filter((label) => !(label in ROW_PERMISSIONS));
    expect(unmapped).toEqual([]);
  });

  it('every permission appears in the matrix, so no permission exists without a documented rule', () => {
    const documented = new Set(Object.values(ROW_PERMISSIONS));
    const undocumented = Object.keys(PERMISSIONS).filter(
      (permission) => !documented.has(permission as Permission),
    );
    expect(undocumented).toEqual([]);
  });

  it('grants each permission to exactly the roles the matrix allows', () => {
    const mismatches: string[] = [];
    for (const row of rows) {
      const permission = ROW_PERMISSIONS[row.label];
      if (!permission) continue;
      ROLES.forEach((role, index) => {
        const allowedInDocument = row.cells[index] !== '—';
        if (allowedInDocument !== roleHasPermission(role, permission)) {
          mismatches.push(
            `${row.label}: ${role} is "${row.cells[index]}" in the matrix`,
          );
        }
      });
    }
    expect(mismatches).toEqual([]);
  });

  it.each([
    ['only Juniors record collections', 'collection.record', ['JUNIOR']],
    ['only the Super Admin changes roles', 'staff.changeRole', ['SUPER_ADMIN']],
    [
      'Juniors never see profit',
      'money.profit',
      ['SUPER_ADMIN', 'ADMIN', 'SENIOR'],
    ],
    [
      'Seniors do not see business totals (US-004)',
      'money.businessTotals',
      ['SUPER_ADMIN', 'ADMIN'],
    ],
  ] as const)('%s', (_label, permission, roles) => {
    expect(ROLES.filter((role) => roleHasPermission(role, permission))).toEqual(
      roles,
    );
  });
});
