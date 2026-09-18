import { randomUUID } from 'node:crypto';

import { Injectable } from '@nestjs/common';
import type {
  CreateStaffRequest,
  StaffCreated,
  StaffDetail,
  StaffDuty,
  StaffStatusChange,
} from '@repo/contracts';
import type { Prisma, StaffRole, StaffStatus } from '@repo/db';
import {
  type CalendarDate,
  fromUtcMidnight,
  parseCalendarDate,
  toBusinessDate,
  toUtcMidnight,
} from '@repo/domain';

import { AuditWriter } from '../audit/audit.writer.js';
import { isUniqueViolation } from '../organisation/prisma-errors.js';
import type { RequestContext } from '../platform/context/request-context.js';
import { Database } from '../platform/database/database.js';
import {
  AuthorizationError,
  ConflictError,
  DomainError,
  NotFoundError,
} from '../platform/errors/errors.js';
import { PasswordHasher } from './password-hasher.js';
import { StaffDirectoryService } from './staff-directory.service.js';
import { generateTemporaryPassword } from './temporary-password.js';

/**
 * Seniority, most senior first. A role may never act on one above it, nor
 * bring one above it into existence — otherwise an Admin creates a Super Admin
 * and then signs in as them (rbac-matrix.md, Administration).
 */
const RANK: Record<StaffRole, number> = {
  SUPER_ADMIN: 0,
  ADMIN: 1,
  SENIOR: 2,
  JUNIOR: 3,
};

const STAFF_CODE_PREFIX: Record<StaffRole, string> = {
  SUPER_ADMIN: 'SA',
  ADMIN: 'AD',
  SENIOR: 'SR',
  JUNIOR: 'JR',
};

const ROLE_LABEL: Record<StaffRole, string> = {
  SUPER_ADMIN: 'Super Admin',
  ADMIN: 'Admin',
  SENIOR: 'Senior',
  JUNIOR: 'Junior',
};

type Tx = Prisma.TransactionClient;

interface Target {
  id: string;
  userId: string;
  role: StaffRole;
  status: StaffStatus;
  name: string;
  phone: string;
}

const targetFields = {
  id: true,
  userId: true,
  role: true,
  status: true,
  phone: true,
  user: { select: { name: true } },
} as const satisfies Prisma.StaffProfileSelect;

/**
 * Staff administration (M01, US-092): create, correct, change role, suspend
 * and reactivate. Reading the Team is `StaffDirectoryService`; passwords are
 * `StaffPasswordService`.
 *
 * Four rules carry the security of the whole role model, and each is enforced
 * here rather than in a screen:
 *
 * 1. **Never a role above your own.** `staff.create` is an Admin permission,
 *    but an Admin creating a `SUPER_ADMIN` would be a self-promotion one sign-in
 *    away — `403 ROLE_ABOVE_OWN`. The same rank check refuses acting *on*
 *    someone senior (`403 CANNOT_MANAGE_HIGHER_ROLE`), which is why an Admin
 *    cannot suspend the owner.
 * 2. **Never yourself.** Changing your own role or your own status is refused
 *    (`422 CANNOT_CHANGE_OWN_ROLE`, `422 CANNOT_CHANGE_OWN_STATUS`), so nobody
 *    locks themselves — or the business's last Super Admin — out. Correcting
 *    your own name and mobile number is allowed; it grants nothing.
 * 3. **Losing access is never silent.** A staff member with an open line
 *    assignment, or with collections still queued on their phone (M08's sync
 *    report), is refused with `422 STAFF_ON_DUTY` naming both. The Admin must
 *    resend with `acknowledgeOnDuty`, and what was left open comes back in the
 *    response and the audit entry.
 * 4. **Passwords are never chosen here.** A new staff member gets a temporary
 *    password shown once and `mustChangePassword`, exactly as an Admin reset
 *    does (US-003) — one forced-change flow, not two.
 */
@Injectable()
export class StaffAdminService {
  constructor(
    private readonly database: Database,
    private readonly audit: AuditWriter,
    private readonly hasher: PasswordHasher,
    private readonly directory: StaffDirectoryService,
  ) {}

  /** US-092: a `user`, its credential and a `staff_profile`, in one transaction. */
  async create(
    context: RequestContext,
    input: CreateStaffRequest,
    today: CalendarDate = toBusinessDate(new Date()),
  ): Promise<StaffCreated> {
    assertNotAboveOwn(context, input.role);
    const joinedAt = input.joinedAt ? parseCalendarDate(input.joinedAt) : today;
    if (joinedAt > today) {
      throw new DomainError(
        'JOINED_IN_FUTURE',
        'A staff member cannot have joined on a future date.',
        [{ field: 'joinedAt', issue: `must be on or before today (${today})` }],
      );
    }
    // Checked before the transaction so the common refusal names its field;
    // the unique indexes still decide a race, below.
    await this.assertAvailable(input);
    // Hashing is deliberately slow; do it before the transaction opens.
    const temporaryPassword = generateTemporaryPassword();
    const hash = await this.hasher.hash(temporaryPassword);

    try {
      const staff = await this.database.transaction(async (tx) => {
        const userId = randomUUID();
        await tx.user.create({
          data: {
            id: userId,
            name: input.name,
            email: input.email,
            emailVerified: false,
          },
        });
        await tx.account.create({
          data: {
            id: randomUUID(),
            accountId: userId,
            providerId: 'credential',
            userId,
            password: hash,
          },
        });
        const created = await tx.staffProfile.create({
          data: {
            organizationId: context.organizationId,
            userId,
            staffCode: generateStaffCode(input.role),
            role: input.role,
            phone: input.phone,
            // The temporary password is replaced at the first sign-in (US-003).
            mustChangePassword: true,
            joinedAt: toUtcMidnight(joinedAt),
            createdByUserId: context.userId,
          },
          select: { id: true, staffCode: true },
        });
        await this.audit.record(context, {
          action: 'CREATE',
          entityTable: 'staff_profile',
          entityId: created.id,
          after: {
            name: input.name,
            email: input.email,
            phone: input.phone,
            role: input.role,
            staffCode: created.staffCode,
            joinedAt,
          },
        });
        return this.directory.get(context, created.id, today);
      });
      return { staff, temporaryPassword };
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
      // Name which of email or phone a concurrent write took, if either.
      await this.assertAvailable(input);
      throw error;
    }
  }

  /** US-092: correct the name or mobile number. Role and status have their own routes. */
  async update(
    context: RequestContext,
    staffProfileId: string,
    input: { name: string; phone: string },
    today: CalendarDate = toBusinessDate(new Date()),
  ): Promise<StaffDetail> {
    const target = await this.findTarget(context, staffProfileId);
    assertMayActOn(context, target);
    if (input.phone !== target.phone) {
      await this.assertPhoneFree(input.phone);
    }

    try {
      return await this.database.transaction(async (tx) => {
        await tx.user.update({
          where: { id: target.userId },
          data: { name: input.name },
        });
        await tx.staffProfile.update({
          where: { id: target.id },
          data: { phone: input.phone },
        });
        await this.audit.record(context, {
          action: 'UPDATE',
          entityTable: 'staff_profile',
          entityId: target.id,
          before: { name: target.name, phone: target.phone },
          after: { name: input.name, phone: input.phone },
        });
        return this.directory.get(context, target.id, today);
      });
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
      await this.assertPhoneFree(input.phone);
      throw error;
    }
  }

  /**
   * US-092: role change, Super Admin only (`staff.changeRole`).
   *
   * Refused on yourself, so the only Super Admin cannot demote themselves out
   * of the business. Refused while a line assignment the new role could not
   * hold is open, because `line_assignment.assignmentRole` is chosen from the
   * staff member's role when it is made (M03) — a Senior turned Junior would
   * otherwise stay a line's Senior.
   */
  async changeRole(
    context: RequestContext,
    staffProfileId: string,
    role: StaffRole,
    today: CalendarDate = toBusinessDate(new Date()),
  ): Promise<StaffDetail> {
    const target = await this.findTarget(context, staffProfileId);
    if (target.id === context.staffProfileId) {
      throw new DomainError(
        'CANNOT_CHANGE_OWN_ROLE',
        'You cannot change your own role. Another Super Admin must do it.',
      );
    }
    assertMayActOn(context, target);
    assertNotAboveOwn(context, role);
    if (role === target.role) {
      throw new DomainError(
        'ROLE_UNCHANGED',
        `They are already a ${ROLE_LABEL[role]}.`,
        [{ field: 'role', issue: 'is the role they already have' }],
      );
    }

    return this.database.transaction(async (tx) => {
      // Read inside the transaction: an assignment made concurrently must
      // either be seen here or wait for this row.
      const { openAssignment: open } = await this.duty(tx, target.id, today);
      if (open && open.assignmentRole !== role) {
        throw new DomainError(
          'STAFF_HAS_OPEN_ASSIGNMENT',
          `They are the ${ROLE_LABEL[open.assignmentRole]} on ${open.lineName}. Assign someone else to that line first.`,
          [
            {
              field: 'role',
              issue: `conflicts with an open assignment on ${open.lineCode}`,
            },
          ],
        );
      }
      await tx.staffProfile.update({
        where: { id: target.id },
        data: { role },
      });
      await this.audit.record(context, {
        action: 'UPDATE',
        entityTable: 'staff_profile',
        entityId: target.id,
        before: { role: target.role },
        after: { role },
      });
      return this.directory.get(context, target.id, today);
    });
  }

  /**
   * US-092: suspend, deactivate or reactivate (`staff.suspend`).
   *
   * Leaving `ACTIVE` takes effect at once — `PolicyGuard` resolves status on
   * every request — and **deletes every session the staff member holds**, so a
   * phone in someone else's hands stops working. That is also what makes it
   * destructive: an unsynced outbox on that phone can no longer be drained, so
   * the refusal in rule 3 above stands between the Admin and losing collections.
   */
  async changeStatus(
    context: RequestContext,
    staffProfileId: string,
    input: { status: StaffStatus; acknowledgeOnDuty: boolean },
    today: CalendarDate = toBusinessDate(new Date()),
  ): Promise<StaffStatusChange> {
    const target = await this.findTarget(context, staffProfileId);
    if (target.id === context.staffProfileId) {
      throw new DomainError(
        'CANNOT_CHANGE_OWN_STATUS',
        'You cannot suspend or deactivate yourself. Another administrator must do it.',
      );
    }
    assertMayActOn(context, target);
    if (input.status === target.status) {
      throw new DomainError(
        'STATUS_UNCHANGED',
        'That is already their status.',
        [{ field: 'status', issue: 'is the status they already have' }],
      );
    }

    const losingAccess = input.status !== 'ACTIVE';

    return this.database.transaction(async (tx) => {
      const duty = await this.duty(tx, target.id, today);
      if (losingAccess && !input.acknowledgeOnDuty) {
        assertOffDuty(target.name, duty);
      }
      await tx.staffProfile.update({
        where: { id: target.id },
        data: { status: input.status },
      });
      const revoked = losingAccess
        ? await tx.session.deleteMany({ where: { userId: target.userId } })
        : { count: 0 };
      await this.audit.record(context, {
        action: 'UPDATE',
        entityTable: 'staff_profile',
        entityId: target.id,
        before: { status: target.status },
        after: {
          status: input.status,
          sessionsRevoked: revoked.count,
          ...(losingAccess && duty.openAssignment
            ? { openAssignmentLeft: duty.openAssignment.lineId }
            : {}),
          ...(losingAccess && duty.unsyncedWork
            ? { unsyncedAtChange: duty.unsyncedWork.unsentCount }
            : {}),
        },
      });
      return {
        staff: await this.directory.get(context, target.id, today),
        sessionsRevoked: revoked.count,
        openAssignment: losingAccess ? duty.openAssignment : null,
        unsyncedWork: losingAccess ? duty.unsyncedWork : null,
      };
    });
  }

  /**
   * What the staff member would leave behind: the line assignment still open
   * or starting later, and the collections their phone has not sent (M08).
   */
  private async duty(
    tx: Tx,
    staffProfileId: string,
    today: CalendarDate,
  ): Promise<StaffDuty> {
    const day = toUtcMidnight(today);
    const [assignment, report] = await Promise.all([
      tx.lineAssignment.findFirst({
        where: {
          staffProfileId,
          OR: [{ effectiveTo: null }, { effectiveTo: { gte: day } }],
        },
        select: {
          id: true,
          lineId: true,
          assignmentRole: true,
          effectiveFrom: true,
          effectiveTo: true,
          line: { select: { code: true, name: true } },
        },
        orderBy: [{ effectiveFrom: 'desc' }, { id: 'desc' }],
      }),
      tx.deviceSyncReport.findFirst({
        where: { staffProfileId, unsentCount: { gt: 0 } },
        select: {
          unsentCount: true,
          oldestUnsentAt: true,
          reportedAt: true,
        },
      }),
    ]);

    return {
      openAssignment: assignment
        ? {
            assignmentId: assignment.id,
            lineId: assignment.lineId,
            lineCode: assignment.line.code,
            lineName: assignment.line.name,
            assignmentRole: assignment.assignmentRole,
            effectiveFrom: fromUtcMidnight(assignment.effectiveFrom),
            effectiveTo: assignment.effectiveTo
              ? fromUtcMidnight(assignment.effectiveTo)
              : null,
          }
        : null,
      unsyncedWork: report
        ? {
            unsentCount: report.unsentCount,
            oldestUnsentAt: report.oldestUnsentAt?.toISOString() ?? null,
            reportedAt: report.reportedAt.toISOString(),
          }
        : null,
    };
  }

  /** Out of scope, soft-deleted or missing are one answer (M02). */
  private async findTarget(
    context: RequestContext,
    staffProfileId: string,
  ): Promise<Target> {
    const row = await this.database.client.staffProfile.findFirst({
      where: {
        id: staffProfileId,
        organizationId: context.organizationId,
        deletedAt: null,
      },
      select: targetFields,
    });
    if (!row) {
      throw new NotFoundError('STAFF_NOT_FOUND', 'Staff not found');
    }
    return { ...row, name: row.user.name };
  }

  private async assertAvailable(input: {
    email: string;
    phone: string;
  }): Promise<void> {
    const user = await this.database.client.user.findFirst({
      where: { email: input.email },
      select: { id: true },
    });
    if (user) {
      throw new ConflictError(
        'EMAIL_TAKEN',
        'That email already has a Rasi account. Use another email.',
        [{ field: 'email', issue: 'already has an account' }],
      );
    }
    await this.assertPhoneFree(input.phone);
  }

  private async assertPhoneFree(phone: string): Promise<void> {
    const staff = await this.database.client.staffProfile.findFirst({
      where: { phone },
      select: { id: true },
    });
    if (staff) {
      throw new ConflictError(
        'PHONE_TAKEN',
        'That mobile number already belongs to a staff member. Use another number.',
        [{ field: 'phone', issue: 'already belongs to a staff member' }],
      );
    }
  }
}

/** Rule 1, on the role being written. */
function assertNotAboveOwn(context: RequestContext, role: StaffRole): void {
  if (RANK[role] >= RANK[context.role]) return;
  throw new AuthorizationError(
    'ROLE_ABOVE_OWN',
    `A ${ROLE_LABEL[context.role]} cannot give someone the ${ROLE_LABEL[role]} role.`,
    [{ field: 'role', issue: 'is senior to your own role' }],
  );
}

/** Rule 1, on the person being changed. */
function assertMayActOn(
  context: RequestContext,
  target: { role: StaffRole },
): void {
  if (RANK[target.role] >= RANK[context.role]) return;
  throw new AuthorizationError(
    'CANNOT_MANAGE_HIGHER_ROLE',
    `Only a ${ROLE_LABEL[target.role]} can change another ${ROLE_LABEL[target.role]}.`,
  );
}

/** Rule 3: what the Admin must acknowledge before access is taken away. */
function assertOffDuty(name: string, duty: StaffDuty): void {
  const details = [];
  if (duty.openAssignment) {
    details.push({
      field: 'acknowledgeOnDuty',
      issue: `${name} is still the ${ROLE_LABEL[duty.openAssignment.assignmentRole]} on ${duty.openAssignment.lineName} (${duty.openAssignment.lineCode})`,
    });
  }
  if (duty.unsyncedWork) {
    const count = duty.unsyncedWork.unsentCount;
    details.push({
      field: 'acknowledgeOnDuty',
      issue: `${count} ${count === 1 ? 'collection is' : 'collections are'} still on their phone and not yet received`,
    });
  }
  if (details.length === 0) return;
  throw new DomainError(
    'STAFF_ON_DUTY',
    `${name} is still on duty. Signing them out now ends their line assignment in name only, and anything left on their phone can never be sent.`,
    details,
  );
}

/**
 * Globally unique, like the owner's `OWNER-…` (ADR-0012), and readable enough
 * to say over a phone. Not chosen by the Admin: a code is an identifier, and a
 * business that wants its own numbering has no rule the system could honour.
 */
function generateStaffCode(role: StaffRole): string {
  return `${STAFF_CODE_PREFIX[role]}-${randomUUID().slice(0, 8).toUpperCase()}`;
}
