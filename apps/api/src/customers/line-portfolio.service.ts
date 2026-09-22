import { Injectable } from '@nestjs/common';
import type { LinePortfolio } from '@repo/contracts';
import {
  addCalendarDays,
  type CalendarDate,
  toBusinessDate,
  toMoney,
  toUtcMidnight,
} from '@repo/domain';

import {
  customerScope,
  foundInScope,
  inScope,
  lineScope,
} from '../access/scope.js';
import type { RequestContext } from '../platform/context/request-context.js';
import { Database } from '../platform/database/database.js';

/**
 * J-09 — a line's customer portfolio, in visiting order (US-040): what each
 * customer owes and how their accounts stand, with the line's totals. The
 * Junior's Customers tab reads it; any role in the line's scope may.
 *
 * **No invested amount or profit** — the one shape a Junior may see (RBAC
 * matrix, money visibility). Money is summed as `Decimal` (BR-11), and read in
 * a fixed number of queries whatever the line's size.
 */
@Injectable()
export class LinePortfolioService {
  constructor(private readonly database: Database) {}

  async get(
    context: RequestContext,
    lineId: string,
    today: CalendarDate = toBusinessDate(new Date()),
  ): Promise<LinePortfolio> {
    const client = this.database.client;
    const line = foundInScope(
      await client.line.findFirst({
        where: inScope(lineScope(context), { id: lineId }),
        select: { id: true },
      }),
      'line',
    );
    const day = toUtcMidnight(today);
    const weekStart = toUtcMidnight(addCalendarDays(today, -6));

    const customers = await client.customer.findMany({
      where: inScope(customerScope(context), {
        lineId: line.id,
        deletedAt: null,
      }),
      orderBy: [
        { routePosition: { sort: 'asc', nulls: 'last' } },
        { customerCode: 'asc' },
      ],
      select: {
        id: true,
        customerCode: true,
        name: true,
        address: true,
        mobile: true,
        routePosition: true,
        accountLoans: {
          select: {
            status: true,
            outstandingAmount: true,
            isOverdue: true,
            _count: {
              select: {
                schedules: { where: { status: 'MISSED' } },
              },
            },
            schedules: {
              where: { dueDate: day, status: 'PENDING' },
              select: { id: true },
              take: 1,
            },
          },
        },
      },
    });
    const ids = customers.map((customer) => customer.id);

    // Money that came in, as originals that stand (BR-14): today's to mark
    // "paid today", the week's for the line total.
    const recent = await client.collection.findMany({
      where: {
        accountLoan: { customerId: { in: ids } },
        entryType: 'ORIGINAL',
        status: 'CONFIRMED',
        amount: { gt: 0 },
        businessDate: { gte: weekStart, lte: day },
      },
      select: {
        amount: true,
        businessDate: true,
        accountLoan: { select: { customerId: true } },
      },
    });
    const paidToday = new Set(
      recent
        .filter((row) => row.businessDate.getTime() === day.getTime())
        .map((row) => row.accountLoan.customerId),
    );
    const collectedWeek = recent.reduce(
      (sum, row) => sum.plus(toMoney(row.amount.toString())),
      toMoney('0'),
    );

    let lineOutstanding = toMoney('0');
    let activeAccounts = 0;
    let overdueCustomers = 0;
    const rows = customers.map((customer) => {
      let outstanding = toMoney('0');
      let active = 0;
      let completed = 0;
      let overdue = false;
      let missed = 0;
      let dueToday = false;
      for (const account of customer.accountLoans) {
        if (account.status === 'COMPLETED') completed += 1;
        if (account.status !== 'ACTIVE') continue;
        active += 1;
        outstanding = outstanding.plus(
          toMoney(account.outstandingAmount.toString()),
        );
        overdue ||= account.isOverdue;
        missed += account._count.schedules;
        dueToday ||= account.schedules.length > 0;
      }
      lineOutstanding = lineOutstanding.plus(outstanding);
      activeAccounts += active;
      if (overdue) overdueCustomers += 1;
      return {
        customerId: customer.id,
        customerCode: customer.customerCode,
        name: customer.name,
        address: customer.address,
        mobile: customer.mobile,
        position: customer.routePosition,
        outstandingTotal: outstanding.toFixed(2),
        activeAccounts: active,
        completedAccounts: completed,
        overdue,
        missedDays: missed,
        dueToday,
        paidToday: paidToday.has(customer.id),
      };
    });

    return {
      businessDate: today,
      totals: {
        outstandingTotal: lineOutstanding.toFixed(2),
        activeAccounts,
        overdueCustomers,
        collectedLastSevenDays: collectedWeek.toFixed(2),
      },
      customers: rows,
    };
  }
}
