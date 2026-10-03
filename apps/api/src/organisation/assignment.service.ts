import { Injectable } from '@nestjs/common';
import type { Assignment } from '@repo/contracts';
import type { AssignmentRole, Prisma } from '@repo/db';
import {
  addCalendarDays,
  type CalendarDate,
  fromUtcMidnight,
  parseCalendarDate,
  toUtcMidnight,
} from '@repo/domain';

import { foundInScope, inScope, lineScope } from '../access/scope.js';
import { AuditWriter } from '../audit/audit.writer.js';
import { EventNotices } from '../notifications/event-notices.js';
import type { RequestContext } from '../platform/context/request-context.js';
import { Database } from '../platform/database/database.js';
import { ConflictError, DomainError } from '../platform/errors/errors.js';
import { isUniqueViolation } from './prisma-errors.js';

export interface AssignmentResult {
  assignment: Assignment;
  closed: Assignment[];
}

type AssignmentRow = Prisma.LineAssignmentGetPayload<{
  select: typeof assignmentFields;
}>;

const assignmentFields = {
  id: true,
  lineId: true,
  staffProfileId: true,
  assignmentRole: true,
  effectiveFrom: true,
  effectiveTo: true,
} as const;

function toAssignment(row: AssignmentRow): Assignment {
  return {
    ...row,
    effectiveFrom: fromUtcMidnight(row.effectiveFrom),
    effectiveTo: row.effectiveTo ? fromUtcMidnight(row.effectiveTo) : null,
  };
}

/**
 * Staffing a line (M03, US-012, US-013).
 *
 * **A Senior or Junior may work several lines at once (decided 2026-10-03).**
 * Assigning someone to a line adds it; their other lines stay. Leaving a line
 * is its own act, {@link AssignmentService.end}. A line still has one Senior,
 * so assigning a Senior closes the line's incumbent Senior — its
 * `effectiveTo` becomes the day before the new `effectiveFrom` — in the same
 * transaction.
 *
 * Assignments are temporal and nothing is deleted. Collections are not
 * touched, because their `lineId` and `collectedByUserId` were frozen when
 * they were recorded (BR-15).
 *
 * The partial unique indexes on `line_assignment` (one open Senior per line,
 * one open row per person and line) are the backstop for a concurrent change:
 * a second writer gets `409 ASSIGNMENT_CONFLICT`.
 */
@Injectable()
export class AssignmentService {
  constructor(
    private readonly database: Database,
    private readonly audit: AuditWriter,
    private readonly notices: EventNotices,
  ) {}

  /**
   * US-012: assigns a Senior, closing the line's incumbent Senior. A Senior
   * already running other lines keeps them.
   */
  assignSenior(
    context: RequestContext,
    lineId: string,
    input: { staffProfileId: string; effectiveFrom: string },
  ): Promise<AssignmentResult> {
    return this.assign(context, lineId, input, 'SENIOR');
  }

  /** US-013: adds a line to a Junior; the lines they already work stay. */
  assignJunior(
    context: RequestContext,
    lineId: string,
    input: { staffProfileId: string; effectiveFrom: string },
  ): Promise<AssignmentResult> {
    return this.assign(context, lineId, input, 'JUNIOR');
  }

  private async assign(
    context: RequestContext,
    lineId: string,
    input: { staffProfileId: string; effectiveFrom: string },
    role: AssignmentRole,
  ): Promise<AssignmentResult> {
    const effectiveFrom = parseCalendarDate(input.effectiveFrom);

    try {
      return await this.database.transaction(async (tx) => {
        const line = foundInScope(
          await tx.line.findFirst({
            where: inScope(lineScope(context), { id: lineId }),
            select: { id: true, isActive: true, name: true },
          }),
          'line',
        );
        if (!line.isActive) {
          throw new DomainError(
            'LINE_INACTIVE',
            'Staff cannot be assigned to an inactive line',
          );
        }

        const staff = foundInScope(
          await tx.staffProfile.findFirst({
            where: {
              id: input.staffProfileId,
              organizationId: context.organizationId,
              deletedAt: null,
            },
            select: {
              id: true,
              userId: true,
              role: true,
              status: true,
              joinedAt: true,
            },
          }),
          'staff',
        );
        this.checkStaff(staff, role, effectiveFrom);

        // Only this line's open rows: this person already on it, or — for a
        // Senior — the incumbent Senior it replaces. Their other lines are
        // not this change's business.
        const open = await tx.lineAssignment.findMany({
          where: {
            effectiveTo: null,
            lineId: line.id,
            OR: [
              { staffProfileId: staff.id },
              ...(role === 'SENIOR'
                ? [{ assignmentRole: 'SENIOR' as const }]
                : []),
            ],
          },
          select: assignmentFields,
        });

        if (open.some((row) => row.staffProfileId === staff.id)) {
          throw new ConflictError(
            'ALREADY_ASSIGNED',
            'This staff member is already assigned to this line',
          );
        }

        const closedOn = addCalendarDays(effectiveFrom, -1);
        const closed: Assignment[] = [];

        // Every outgoing row is checked before any is changed.
        for (const row of open) {
          if (fromUtcMidnight(row.effectiveFrom) >= effectiveFrom) {
            throw new DomainError(
              'EFFECTIVE_NOT_AFTER_CURRENT',
              'The new assignment must start after the assignment it replaces',
              [
                {
                  field: 'effectiveFrom',
                  issue: `must be after ${fromUtcMidnight(row.effectiveFrom)}`,
                },
              ],
            );
          }
        }

        for (const row of open) {
          const updated = await tx.lineAssignment.update({
            where: { id: row.id },
            data: { effectiveTo: toUtcMidnight(closedOn) },
            select: assignmentFields,
          });
          await this.audit.record(context, {
            action: 'UPDATE',
            entityTable: 'line_assignment',
            entityId: row.id,
            before: { effectiveTo: null },
            after: { effectiveTo: closedOn },
          });
          closed.push(toAssignment(updated));
        }

        const created = await tx.lineAssignment.create({
          data: {
            lineId: line.id,
            staffProfileId: staff.id,
            assignmentRole: role,
            effectiveFrom: toUtcMidnight(effectiveFrom),
            createdByUserId: context.userId,
          },
          select: assignmentFields,
        });
        await this.audit.record(context, {
          action: 'CREATE',
          entityTable: 'line_assignment',
          entityId: created.id,
          after: {
            lineId: line.id,
            staffProfileId: staff.id,
            assignmentRole: role,
            effectiveFrom,
          },
        });

        await this.notices.assignmentMade({
          actorUserId: context.userId,
          staffUserId: staff.userId,
          role,
          lineId: line.id,
          lineName: line.name,
          effectiveFrom,
        });

        return { assignment: toAssignment(created), closed };
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ConflictError(
          'ASSIGNMENT_CONFLICT',
          'The line or staff member was reassigned at the same time. Reload and try again.',
        );
      }
      throw error;
    }
  }

  /**
   * Takes a Senior or Junior off one line: the open assignment's last day
   * becomes `effectiveTo`, inclusive. Their other lines are untouched. Like
   * starting an assignment, it may be dated back — an Admin recording that
   * someone left yesterday — but never before the assignment began.
   *
   * A line whose Senior leaves has none until another is assigned; the line
   * list already flags "No Senior" (US-014).
   */
  async end(
    context: RequestContext,
    assignmentId: string,
    input: { effectiveTo: string },
  ): Promise<Assignment> {
    const effectiveTo = parseCalendarDate(input.effectiveTo);
    return this.database.transaction(async (tx) => {
      const found = foundInScope(
        await tx.lineAssignment.findFirst({
          where: { id: assignmentId, line: lineScope(context) },
          select: { id: true },
        }),
        'assignment',
      );
      // Locked so a concurrent end or reassignment waits, then sees the row
      // already closed.
      await tx.$queryRaw`SELECT id FROM line_assignment WHERE id = ${found.id} FOR UPDATE`;
      const row = await tx.lineAssignment.findUniqueOrThrow({
        where: { id: found.id },
        select: assignmentFields,
      });
      if (row.effectiveTo !== null) {
        throw new ConflictError(
          'ASSIGNMENT_ALREADY_ENDED',
          `This assignment already ended on ${fromUtcMidnight(row.effectiveTo)}`,
        );
      }
      const effectiveFrom = fromUtcMidnight(row.effectiveFrom);
      if (effectiveTo < effectiveFrom) {
        throw new DomainError(
          'EFFECTIVE_TO_BEFORE_START',
          'The last day cannot be before the assignment began',
          [
            {
              field: 'effectiveTo',
              issue: `must be on or after ${effectiveFrom}`,
            },
          ],
        );
      }
      const updated = await tx.lineAssignment.update({
        where: { id: row.id },
        data: { effectiveTo: toUtcMidnight(effectiveTo) },
        select: assignmentFields,
      });
      await this.audit.record(context, {
        action: 'UPDATE',
        entityTable: 'line_assignment',
        entityId: row.id,
        before: { effectiveTo: null },
        after: { effectiveTo },
      });
      return toAssignment(updated);
    });
  }

  private checkStaff(
    staff: { role: string; status: string; joinedAt: Date },
    role: AssignmentRole,
    effectiveFrom: CalendarDate,
  ): void {
    if (staff.status !== 'ACTIVE') {
      throw new DomainError(
        'STAFF_NOT_ACTIVE',
        'Only active staff can be assigned to a line',
      );
    }
    // Roles are single-valued (M01): a Senior staffs a line as its Senior.
    if (staff.role !== role) {
      throw new DomainError(
        'STAFF_ROLE_MISMATCH',
        `Only a ${role === 'SENIOR' ? 'Senior' : 'Junior'} can take this assignment`,
        [{ field: 'staffProfileId', issue: `is not a ${role}` }],
      );
    }
    // M03 risks: an assignment cannot begin before the person joined.
    const joined = fromUtcMidnight(staff.joinedAt);
    if (effectiveFrom < joined) {
      throw new DomainError(
        'EFFECTIVE_BEFORE_JOINING',
        'An assignment cannot start before the staff member joined',
        [{ field: 'effectiveFrom', issue: `must be on or after ${joined}` }],
      );
    }
  }
}
