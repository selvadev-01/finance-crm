import { Injectable } from '@nestjs/common';
import type { StaffDetail, StaffSummary } from '@repo/contracts';
import type { Prisma } from '@repo/db';
import {
  type CalendarDate,
  fromUtcMidnight,
  toBusinessDate,
  toUtcMidnight,
} from '@repo/domain';

import {
  assignmentInEffectOn,
  assignmentScope,
  foundInScope,
  inScope,
  staffScope,
} from '../access/scope.js';
import type { RequestContext } from '../platform/context/request-context.js';
import { Database } from '../platform/database/database.js';
import {
  type Page,
  type PageRequest,
  pageArgs,
  toPage,
} from '../platform/pagination.js';

const assignmentFields = {
  id: true,
  lineId: true,
  assignmentRole: true,
  effectiveFrom: true,
  effectiveTo: true,
  line: { select: { code: true, name: true } },
} as const satisfies Prisma.LineAssignmentSelect;

type AssignmentRow = Prisma.LineAssignmentGetPayload<{
  select: typeof assignmentFields;
}>;

function staffFields(today: CalendarDate) {
  return {
    id: true,
    userId: true,
    staffCode: true,
    phone: true,
    role: true,
    status: true,
    joinedAt: true,
    user: { select: { name: true, email: true } },
    // One open row per person is a partial unique index, but closed rows
    // could still overlap if hand-edited — the latest start wins, exactly as
    // in RequestContextResolver, so Team and scope agree on "today's line".
    assignments: {
      where: assignmentInEffectOn(today),
      select: assignmentFields,
      orderBy: [{ effectiveFrom: 'desc' as const }, { id: 'desc' as const }],
      take: 1,
    },
  } as const satisfies Prisma.StaffProfileSelect;
}

type StaffRow = Prisma.StaffProfileGetPayload<{
  select: ReturnType<typeof staffFields>;
}>;

function toAssignment(row: AssignmentRow) {
  return {
    assignmentId: row.id,
    lineId: row.lineId,
    lineCode: row.line.code,
    lineName: row.line.name,
    assignmentRole: row.assignmentRole,
    effectiveFrom: fromUtcMidnight(row.effectiveFrom),
    effectiveTo: row.effectiveTo ? fromUtcMidnight(row.effectiveTo) : null,
  };
}

function toSummary(row: StaffRow): StaffSummary {
  const current = row.assignments[0];
  return {
    staffProfileId: row.id,
    userId: row.userId,
    name: row.user.name,
    email: row.user.email,
    phone: row.phone,
    staffCode: row.staffCode,
    role: row.role,
    status: row.status,
    joinedAt: fromUtcMidnight(row.joinedAt),
    currentAssignment: current ? toAssignment(current) : null,
  };
}

/**
 * The Team read model (M01 staff records joined to M03 assignments, S-14).
 * Scoped by `staffScope`: Admins see their organization, a Senior the staff on
 * their own line today, and a staff member outside that is `404`.
 */
@Injectable()
export class StaffDirectoryService {
  constructor(private readonly database: Database) {}

  async list(
    context: RequestContext,
    page: PageRequest & {
      role?: StaffSummary['role'] | undefined;
      status?: StaffSummary['status'] | undefined;
    },
    today: CalendarDate = toBusinessDate(new Date()),
  ): Promise<Page<StaffSummary>> {
    const rows = await this.database.client.staffProfile.findMany({
      where: inScope(staffScope(context, today), {
        ...(page.role ? { role: page.role } : {}),
        ...(page.status ? { status: page.status } : {}),
      }),
      select: staffFields(today),
      ...pageArgs(page),
    });
    return toPage(rows, page, toSummary);
  }

  async get(
    context: RequestContext,
    staffProfileId: string,
    today: CalendarDate = toBusinessDate(new Date()),
  ): Promise<StaffDetail> {
    const row = foundInScope(
      await this.database.client.staffProfile.findFirst({
        where: inScope(staffScope(context, today), { id: staffProfileId }),
        select: staffFields(today),
      }),
      'staff',
    );
    const history = await this.database.client.lineAssignment.findMany({
      where: inScope(assignmentScope(context), { staffProfileId }),
      select: assignmentFields,
      orderBy: [{ effectiveFrom: 'desc' }, { id: 'desc' }],
    });
    const todayAtMidnight = toUtcMidnight(today).getTime();
    return {
      ...toSummary(row),
      assignments: history.map((assignment) => ({
        ...toAssignment(assignment),
        upcoming: assignment.effectiveFrom.getTime() > todayAtMidnight,
      })),
    };
  }
}
