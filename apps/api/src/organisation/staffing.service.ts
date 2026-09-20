import { Injectable } from '@nestjs/common';
import type { AssignmentHistoryEntry, LineStaffing } from '@repo/contracts';
import {
  type CalendarDate,
  fromUtcMidnight,
  parseCalendarDate,
  toBusinessDate,
} from '@repo/domain';

import {
  assignmentInEffectOn as inEffectOn,
  foundInScope,
  inScope,
  lineScope,
} from '../access/scope.js';
import type { RequestContext } from '../platform/context/request-context.js';
import { Database } from '../platform/database/database.js';
import {
  type Page,
  type PageRequest,
  pageArgs,
  toPage,
} from '../platform/pagination.js';

/**
 * Read models over staffing (M03): who is on each line today (US-014, PDF §20)
 * and who was, on any date (US-015). Scoped by `lineScope`, so a Senior sees
 * only their own line.
 */
@Injectable()
export class StaffingService {
  constructor(private readonly database: Database) {}

  /** US-014: per line, today's Senior, the number of Juniors and of customers. */
  async lineStaffing(
    context: RequestContext,
    page: PageRequest,
    today: CalendarDate = toBusinessDate(new Date()),
  ): Promise<Page<LineStaffing>> {
    const rows = await this.database.client.line.findMany({
      where: inScope(lineScope(context), { isActive: true }),
      select: {
        id: true,
        code: true,
        name: true,
        sectorId: true,
        assignments: {
          // Only staff who can actually work the line today (decided
          // 2026-09-20): a suspended or departed Junior cannot sign in or
          // collect, so counting them makes a line look staffed when nobody
          // is walking it. The assignment itself stays on record (US-015).
          where: {
            ...inEffectOn(today),
            staffProfile: { status: 'ACTIVE', deletedAt: null },
          },
          select: {
            assignmentRole: true,
            staffProfileId: true,
            staffProfile: { select: { user: { select: { name: true } } } },
          },
        },
        _count: { select: { customers: { where: { deletedAt: null } } } },
      },
      ...pageArgs(page),
    });

    return toPage(rows, page, (line) => {
      const senior = line.assignments.find(
        (assignment) => assignment.assignmentRole === 'SENIOR',
      );
      return {
        lineId: line.id,
        code: line.code,
        name: line.name,
        sectorId: line.sectorId,
        senior: senior
          ? {
              staffProfileId: senior.staffProfileId,
              name: senior.staffProfile.user.name,
            }
          : null,
        juniorCount: line.assignments.filter(
          (assignment) => assignment.assignmentRole === 'JUNIOR',
        ).length,
        customerCount: line._count.customers,
      };
    });
  }

  /**
   * US-015: every assignment the line has had — or, with `on`, only those in
   * effect that day: "who was responsible for Line 3 on 14 March".
   */
  async assignmentHistory(
    context: RequestContext,
    lineId: string,
    page: PageRequest & { on?: string | undefined },
  ): Promise<Page<AssignmentHistoryEntry>> {
    foundInScope(
      await this.database.client.line.findFirst({
        where: inScope(lineScope(context), { id: lineId }),
        select: { id: true },
      }),
      'line',
    );

    const rows = await this.database.client.lineAssignment.findMany({
      where: {
        lineId,
        ...(page.on ? inEffectOn(parseCalendarDate(page.on)) : {}),
      },
      select: {
        id: true,
        lineId: true,
        staffProfileId: true,
        assignmentRole: true,
        effectiveFrom: true,
        effectiveTo: true,
        staffProfile: { select: { user: { select: { name: true } } } },
      },
      ...pageArgs(page),
    });

    return toPage(rows, page, (row) => ({
      id: row.id,
      lineId: row.lineId,
      staffProfileId: row.staffProfileId,
      assignmentRole: row.assignmentRole,
      effectiveFrom: fromUtcMidnight(row.effectiveFrom),
      effectiveTo: row.effectiveTo ? fromUtcMidnight(row.effectiveTo) : null,
      staffName: row.staffProfile.user.name,
    }));
  }
}
