import { Injectable } from '@nestjs/common';
import type { Holiday, HolidayChange } from '@repo/contracts';
import { Prisma } from '@repo/db';
import {
  type CalendarDate,
  dayOfWeek,
  fromUtcMidnight,
  type HolidaySet,
  parseCalendarDate,
  shiftForHolidayChange,
  type SlotDate,
  toBusinessDate,
  toUtcMidnight,
} from '@repo/domain';

import {
  foundInScope,
  holidayScope,
  inScope,
  sectorScope,
} from '../access/scope.js';
import { AuditWriter } from '../audit/audit.writer.js';
import { EventNotices } from '../notifications/event-notices.js';
import type { RequestContext } from '../platform/context/request-context.js';
import { Database } from '../platform/database/database.js';
import {
  ConflictError,
  DomainError,
  NotFoundError,
} from '../platform/errors/errors.js';
import { decodeCursor, encodeCursor } from '../platform/pagination.js';
import { isUniqueViolation } from '../organisation/prisma-errors.js';

type Tx = Prisma.TransactionClient;

const holidayFields = {
  id: true,
  date: true,
  name: true,
  sectorId: true,
  createdAt: true,
  createdByUserId: true,
  sector: { select: { id: true, code: true, name: true } },
} satisfies Prisma.HolidaySelect;

type HolidayRow = Prisma.HolidayGetPayload<{ select: typeof holidayFields }>;

/** Rows per statement when moving slots — well under PostgreSQL's parameter limit. */
const CHUNK = 2_000;

/**
 * A business-wide change can move every open account's schedule, so it gets
 * longer than the five-second default a money transaction keeps to.
 */
const SHIFT_TRANSACTION = { timeout: 60_000, maxWait: 5_000 };

/**
 * Declared holidays (M06, US-093). Every method takes the caller's context
 * (M02).
 *
 * Rules, decided here and written in the M06 spec's As built:
 *
 * - **Future dates only.** A date on or before today's business date
 *   (`toBusinessDate`) is refused, for declaring and for removing: that day
 *   may already be closed and its alerts raised (BR-02, open question 1).
 * - **Not a Sunday.** Sundays are never collection days and never holiday rows
 *   (a database CHECK too).
 * - **One per scope and date.** The same date twice for the same sector, or
 *   twice business-wide, is `409`. A sector holiday on a business-wide
 *   holiday's date is allowed, as the database allows it; it moves nothing.
 * - **Schedules follow** (BR-02, US-034): the pending slots of every open
 *   account the change covers are moved in the same transaction by
 *   `shiftForHolidayChange`; answered slots and balances never change.
 * - **Staff are told** (M06): the Seniors and Juniors on the lines it covers.
 */
@Injectable()
export class HolidayService {
  constructor(
    private readonly database: Database,
    private readonly audit: AuditWriter,
    private readonly notices: EventNotices,
  ) {}

  async list(
    context: RequestContext,
    query: {
      period: 'upcoming' | 'past';
      year?: number | undefined;
      cursor?: string | undefined;
      limit: number;
    },
    today: CalendarDate = toBusinessDate(new Date()),
  ): Promise<{
    data: Holiday[];
    nextCursor: string | null;
    hasMore: boolean;
    total: number;
  }> {
    const upcoming = query.period === 'upcoming';
    const day = toUtcMidnight(today);
    const date: Prisma.DateTimeFilter = upcoming ? { gte: day } : { lt: day };
    const year =
      query.year === undefined
        ? {}
        : {
            AND: [
              { date: { gte: new Date(Date.UTC(query.year, 0, 1)) } },
              { date: { lt: new Date(Date.UTC(query.year + 1, 0, 1)) } },
            ],
          };
    const direction = upcoming ? 'asc' : 'desc';
    // One `where` for both reads, so the total carries `holidayScope` exactly
    // as the rows do — a holiday on a sector out of scope is not countable.
    const where = inScope(holidayScope(context), { date, ...year });
    const [rows, total] = await Promise.all([
      this.database.client.holiday.findMany({
        where,
        select: holidayFields,
        // (date, id) is a total order, so a page never repeats or skips a row.
        orderBy: [{ date: direction }, { id: direction }],
        take: query.limit + 1,
        ...(query.cursor
          ? { cursor: { id: decodeCursor(query.cursor) }, skip: 1 }
          : {}),
      }),
      this.database.client.holiday.count({ where }),
    ]);
    const hasMore = rows.length > query.limit;
    const visible = hasMore ? rows.slice(0, query.limit) : rows;
    const names = await this.names(visible);
    return {
      data: visible.map((row) => toHoliday(row, names, today)),
      nextCursor:
        hasMore && visible.length > 0 ? encodeCursor(visible.at(-1)!.id) : null,
      hasMore,
      total,
    };
  }

  declare(
    context: RequestContext,
    input: { date: string; name: string; sectorId?: string | undefined },
    today: CalendarDate = toBusinessDate(new Date()),
  ): Promise<HolidayChange> {
    return this.database.transaction(async (tx) => {
      const date = parseCalendarDate(input.date);
      assertFuture(date, today);
      if (dayOfWeek(date) === 0) {
        throw new DomainError(
          'HOLIDAY_ON_SUNDAY',
          'Sundays are never collection days, so they are not declared as holidays.',
          [{ field: 'date', issue: 'is a Sunday' }],
        );
      }
      const sector = input.sectorId
        ? await this.activeSector(tx, context, input.sectorId)
        : null;

      await lockOrganization(tx, context.organizationId);
      const existing = await tx.holiday.findFirst({
        where: {
          organizationId: context.organizationId,
          date: toUtcMidnight(date),
          sectorId: sector?.id ?? null,
        },
        select: { name: true },
      });
      if (existing) throw alreadyDeclared(existing.name);

      let row: HolidayRow;
      try {
        row = await tx.holiday.create({
          data: {
            organizationId: context.organizationId,
            date: toUtcMidnight(date),
            name: input.name,
            sectorId: sector?.id ?? null,
            createdByUserId: context.userId,
          },
          select: holidayFields,
        });
      } catch (error) {
        if (isUniqueViolation(error)) throw alreadyDeclared(input.name);
        throw error;
      }

      const accountsShifted = await this.shiftSchedules(tx, context, {
        date,
        sectorId: sector?.id ?? null,
        kind: 'declared',
      });
      await this.audit.record(context, {
        action: 'CREATE',
        entityTable: 'holiday',
        entityId: row.id,
        after: {
          date,
          name: row.name,
          sectorId: row.sectorId,
          accountsShifted,
        },
      });
      await this.notices.holidayChanged({
        actorUserId: context.userId,
        organizationId: context.organizationId,
        sectorId: row.sectorId,
        sectorName: row.sector?.name ?? null,
        date,
        name: row.name,
        change: 'DECLARED',
      });

      const names = await this.names([row]);
      return { ...toHoliday(row, names, today), accountsShifted };
    }, SHIFT_TRANSACTION);
  }

  remove(
    context: RequestContext,
    holidayId: string,
    today: CalendarDate = toBusinessDate(new Date()),
  ): Promise<HolidayChange> {
    return this.database.transaction(async (tx) => {
      await lockOrganization(tx, context.organizationId);
      const row = foundInScope(
        await tx.holiday.findFirst({
          where: inScope(holidayScope(context), { id: holidayId }),
          select: holidayFields,
        }),
        'holiday',
      );
      const date = fromUtcMidnight(row.date);
      assertFuture(date, today);

      await tx.holiday.delete({ where: { id: row.id } });
      const accountsShifted = await this.shiftSchedules(tx, context, {
        date,
        sectorId: row.sectorId,
        kind: 'removed',
      });
      await this.audit.record(context, {
        action: 'DELETE',
        entityTable: 'holiday',
        entityId: row.id,
        before: { date, name: row.name, sectorId: row.sectorId },
        after: { accountsShifted },
      });
      await this.notices.holidayChanged({
        actorUserId: context.userId,
        organizationId: context.organizationId,
        sectorId: row.sectorId,
        sectorName: row.sector?.name ?? null,
        date,
        name: row.name,
        change: 'REMOVED',
      });

      const names = await this.names([row]);
      return {
        ...toHoliday(row, names, today),
        removable: false,
        accountsShifted,
      };
    }, SHIFT_TRANSACTION);
  }

  /**
   * BR-02 / US-034: moves the pending slots of every open account the change
   * covers — its sector's, or the whole organization's — and their target and
   * first collection dates. Returns how many accounts changed.
   *
   * Accounts are locked (in id order) before their slots are read, so a
   * collection settling one of them either finished first or waits and then
   * sees the new holiday. The set is re-read after locking until it stops
   * growing, because a collection that committed meanwhile can extend a tail
   * onto the date.
   */
  private async shiftSchedules(
    tx: Tx,
    context: RequestContext,
    change: {
      date: CalendarDate;
      sectorId: string | null;
      kind: 'declared' | 'removed';
    },
  ): Promise<number> {
    const day = toUtcMidnight(change.date);
    const where: Prisma.AccountLoanWhereInput = {
      organizationId: context.organizationId,
      status: { in: ['PENDING', 'ACTIVE'] },
      ...(change.sectorId ? { customer: { sectorId: change.sectorId } } : {}),
      ...(change.kind === 'declared'
        ? { schedules: { some: { status: 'PENDING', dueDate: day } } }
        : {
            disbursementDate: { lt: day },
            schedules: { some: { status: 'PENDING', dueDate: { gt: day } } },
          }),
    };

    const locked = new Set<string>();
    for (;;) {
      const found = await tx.accountLoan.findMany({
        where,
        select: { id: true },
        orderBy: { id: 'asc' },
      });
      const fresh = found.map((row) => row.id).filter((id) => !locked.has(id));
      if (fresh.length === 0) break;
      for (const ids of chunks(fresh)) {
        await tx.$queryRaw`SELECT id FROM account_loan WHERE id IN (${Prisma.join(ids)}) ORDER BY id FOR UPDATE`;
      }
      for (const id of fresh) locked.add(id);
    }
    if (locked.size === 0) return 0;

    const holidays = await this.holidaySets(tx, context.organizationId, day);
    let shifted = 0;
    for (const ids of chunks([...locked].sort())) {
      const accounts = await tx.accountLoan.findMany({
        where: { id: { in: ids } },
        select: {
          id: true,
          disbursementDate: true,
          collectionFrequency: true,
          customer: { select: { sectorId: true } },
          schedules: {
            where: { status: 'PENDING' },
            select: { sequence: true, dueDate: true },
          },
        },
      });
      const moves: { accountLoanId: string; slot: SlotDate }[] = [];
      for (const account of accounts) {
        const pending = account.schedules.map((slot) => ({
          sequence: slot.sequence,
          dueDate: fromUtcMidnight(slot.dueDate),
        }));
        const moved = shiftForHolidayChange({
          pending,
          changedDate: change.date,
          disbursementDate: fromUtcMidnight(account.disbursementDate),
          frequency: account.collectionFrequency,
          holidays: holidays(account.customer.sectorId),
        });
        if (moved.length === 0) continue;
        shifted += 1;
        for (const slot of moved)
          moves.push({ accountLoanId: account.id, slot });

        const after = pending.map(
          (slot) => moved.find((m) => m.sequence === slot.sequence) ?? slot,
        );
        const last = after.reduce((a, b) => (b.dueDate > a.dueDate ? b : a));
        const first = moved.find((slot) => slot.sequence === 1);
        await tx.accountLoan.update({
          where: { id: account.id },
          data: {
            targetCompletionDate: toUtcMidnight(last.dueDate),
            ...(first
              ? { firstCollectionDate: toUtcMidnight(first.dueDate) }
              : {}),
          },
        });
      }
      await moveSlots(tx, moves);
    }
    return shifted;
  }

  /** The holidays on or after `from`, resolved per sector after the change. */
  private async holidaySets(
    tx: Tx,
    organizationId: string,
    from: Date,
  ): Promise<(sectorId: string) => HolidaySet> {
    const rows = await tx.holiday.findMany({
      where: { organizationId, date: { gte: from } },
      select: { date: true, sectorId: true },
    });
    const businessWide = rows
      .filter((row) => row.sectorId === null)
      .map((row) => fromUtcMidnight(row.date));
    const cache = new Map<string, HolidaySet>();
    return (sectorId) => {
      let set = cache.get(sectorId);
      if (!set) {
        set = new Set([
          ...businessWide,
          ...rows
            .filter((row) => row.sectorId === sectorId)
            .map((row) => fromUtcMidnight(row.date)),
        ]);
        cache.set(sectorId, set);
      }
      return set;
    };
  }

  private async activeSector(
    tx: Tx,
    context: RequestContext,
    sectorId: string,
  ) {
    const sector = await tx.sector.findFirst({
      where: inScope(sectorScope(context), { id: sectorId }),
      select: { id: true, name: true, isActive: true },
    });
    if (!sector) {
      throw new NotFoundError('SECTOR_NOT_FOUND', 'Sector not found', [
        { field: 'sectorId', issue: 'is not a sector in this business' },
      ]);
    }
    if (!sector.isActive) {
      throw new DomainError(
        'SECTOR_INACTIVE',
        `${sector.name} is inactive, so it has no collections to skip.`,
        [{ field: 'sectorId', issue: 'is inactive' }],
      );
    }
    return sector;
  }

  private async names(rows: HolidayRow[]): Promise<Map<string, string>> {
    const ids = [
      ...new Set(
        rows
          .map((row) => row.createdByUserId)
          .filter((id): id is string => id !== null),
      ),
    ];
    if (ids.length === 0) return new Map();
    const users = await this.database.client.user.findMany({
      where: { id: { in: ids } },
      select: { id: true, name: true },
    });
    return new Map(users.map((user) => [user.id, user.name]));
  }
}

function toHoliday(
  row: HolidayRow,
  names: Map<string, string>,
  today: CalendarDate,
): Holiday {
  const date = fromUtcMidnight(row.date);
  const addedByName = row.createdByUserId
    ? names.get(row.createdByUserId)
    : undefined;
  return {
    id: row.id,
    date,
    name: row.name,
    sector: row.sector,
    addedBy:
      row.createdByUserId && addedByName
        ? { userId: row.createdByUserId, name: addedByName }
        : null,
    createdAt: row.createdAt.toISOString(),
    removable: date > today,
  };
}

function assertFuture(date: CalendarDate, today: CalendarDate): void {
  if (date > today) return;
  throw new DomainError(
    'HOLIDAY_NOT_IN_FUTURE',
    'Only future dates can be declared or removed as holidays. Past holidays stay as they are.',
    [{ field: 'date', issue: `must be after today (${today})` }],
  );
}

function alreadyDeclared(name: string): ConflictError {
  return new ConflictError(
    'HOLIDAY_EXISTS',
    `That date is already a holiday: ${name}`,
    [{ field: 'date', issue: `is already a holiday (${name})` }],
  );
}

/** Serialises holiday changes within one organization (M06). */
async function lockOrganization(tx: Tx, organizationId: string): Promise<void> {
  await tx.$queryRaw`SELECT id FROM organization WHERE id = ${organizationId} FOR UPDATE`;
}

/** One statement per chunk: each slot keeps its row, sequence and amount. */
async function moveSlots(
  tx: Tx,
  moves: { accountLoanId: string; slot: SlotDate }[],
): Promise<void> {
  for (const part of chunks(moves)) {
    const values = Prisma.join(
      part.map(
        (move) =>
          Prisma.sql`(${move.accountLoanId}, ${move.slot.sequence}::int, ${move.slot.dueDate}::date)`,
      ),
    );
    await tx.$executeRaw`
      UPDATE account_schedule AS slot
      SET "dueDate" = moved.due_date, "updatedAt" = now()
      FROM (VALUES ${values}) AS moved(account_loan_id, sequence, due_date)
      WHERE slot."accountLoanId" = moved.account_loan_id
        AND slot.sequence = moved.sequence
        AND slot.status = 'PENDING'`;
  }
}

function chunks<T>(items: T[]): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += CHUNK) {
    out.push(items.slice(i, i + CHUNK));
  }
  return out;
}
