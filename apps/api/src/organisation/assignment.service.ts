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
import type { RequestContext } from '../platform/context/request-context.js';
import { Database } from '../platform/database/database.js';
import { ConflictError, DomainError } from '../platform/errors/errors.js';
import { isUniqueViolation } from './prisma-errors.js';

export interface AssignmentResult {
  assignment: Assignment;
  closed: Assignment[];
  linesWithoutSenior: string[];
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
 * Assignments are temporal: a change **closes** the outgoing row — its
 * `effectiveTo` becomes the day before the new `effectiveFrom` — and opens a
 * new one, in one transaction. Nothing is deleted. Collections are not
 * touched, because their `lineId` and `collectedByUserId` were frozen when
 * they were recorded (BR-15).
 *
 * The partial unique indexes on `line_assignment` are the backstop for a
 * concurrent change: a second writer gets `409 ASSIGNMENT_CONFLICT`.
 */
@Injectable()
export class AssignmentService {
  constructor(
    private readonly database: Database,
    private readonly audit: AuditWriter,
  ) {}

  /**
   * US-012: assigns a Senior, closing the line's incumbent Senior.
   *
   * A Senior already running another line leaves it (one line at a time), and
   * that line is reported in `linesWithoutSenior` — decided 2026-09-13: the
   * move is allowed rather than refused, so two Seniors can be swapped.
   */
  assignSenior(
    context: RequestContext,
    lineId: string,
    input: { staffProfileId: string; effectiveFrom: string },
  ): Promise<AssignmentResult> {
    return this.assign(context, lineId, input, 'SENIOR');
  }

  /** US-013: assigns a Junior to a line, closing wherever they were. */
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
            select: { id: true, isActive: true },
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
            select: { id: true, role: true, status: true, joinedAt: true },
          }),
          'staff',
        );
        this.checkStaff(staff, role, effectiveFrom);

        const open = await tx.lineAssignment.findMany({
          where: {
            effectiveTo: null,
            OR: [
              { staffProfileId: staff.id },
              ...(role === 'SENIOR'
                ? [{ lineId: line.id, assignmentRole: 'SENIOR' as const }]
                : []),
            ],
          },
          select: assignmentFields,
        });

        if (
          open.some(
            (row) => row.staffProfileId === staff.id && row.lineId === line.id,
          )
        ) {
          throw new ConflictError(
            'ALREADY_ASSIGNED',
            'This staff member is already assigned to this line',
          );
        }

        const closedOn = addCalendarDays(effectiveFrom, -1);
        const closed: Assignment[] = [];
        const linesWithoutSenior: string[] = [];

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
          if (
            row.staffProfileId === staff.id &&
            row.assignmentRole === 'SENIOR' &&
            row.lineId !== line.id
          ) {
            linesWithoutSenior.push(row.lineId);
          }
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
            ...(linesWithoutSenior.length > 0 ? { linesWithoutSenior } : {}),
          },
        });

        return {
          assignment: toAssignment(created),
          closed,
          linesWithoutSenior,
        };
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
