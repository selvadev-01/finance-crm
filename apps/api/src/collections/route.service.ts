import { Injectable } from '@nestjs/common';
import type { RouteView } from '@repo/contracts';
import { Prisma } from '@repo/db';
import {
  type CalendarDate,
  capExpectedAmount,
  dayOfWeek,
  toBusinessDate,
  toMoney,
  toUtcMidnight,
} from '@repo/domain';

import { accountScope, inScope } from '../access/scope.js';
import type { RequestContext } from '../platform/context/request-context.js';
import { Database } from '../platform/database/database.js';

/**
 * US-040 — the Junior's route for a business date: every active account on
 * their line (M02 scope) with a slot due that day, grouped by customer, with
 * what to ask for and what is left. **No invested amount or profit** — the
 * payload has nowhere to put them.
 *
 * A Sunday or a declared holiday is said as such rather than as an empty list
 * (S-01): three different empty days, three different messages.
 */
@Injectable()
export class RouteService {
  constructor(private readonly database: Database) {}

  route(
    context: RequestContext,
    today: CalendarDate = toBusinessDate(new Date()),
  ): Promise<RouteView> {
    // Prisma loads the collections in a separate statement from the accounts.
    // One snapshot keeps `includedKeys` and `outstandingAmount` in agreement
    // while a collection commits concurrently.
    return this.database.transaction((tx) => this.read(tx, context, today), {
      isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
    });
  }

  private async read(
    tx: Prisma.TransactionClient,
    context: RequestContext,
    today: CalendarDate,
  ): Promise<RouteView> {
    const day = toUtcMidnight(today);

    let dayKind: RouteView['day'] = { kind: 'WORKING' };
    if (context.currentLineId) {
      const line = await tx.line.findUnique({
        where: { id: context.currentLineId },
        select: { sectorId: true },
      });
      const holiday = await tx.holiday.findFirst({
        where: {
          organizationId: context.organizationId,
          date: day,
          OR: [{ sectorId: null }, { sectorId: line?.sectorId ?? '' }],
        },
        select: { name: true },
      });
      if (holiday) dayKind = { kind: 'HOLIDAY', name: holiday.name };
    }
    if (dayOfWeek(today) === 0) dayKind = { kind: 'SUNDAY' };

    const accounts =
      dayKind.kind === 'WORKING'
        ? await tx.accountLoan.findMany({
            where: inScope(accountScope(context), {
              status: 'ACTIVE',
              schedules: { some: { dueDate: day } },
            }),
            select: {
              id: true,
              accountCode: true,
              dailyAmount: true,
              outstandingAmount: true,
              _count: {
                select: { schedules: { where: { status: 'PENDING' } } },
              },
              customer: {
                select: {
                  id: true,
                  customerCode: true,
                  name: true,
                  address: true,
                  mobile: true,
                },
              },
              collections: {
                where: { businessDate: day, entryType: 'ORIGINAL' },
                select: {
                  idempotencyKey: true,
                  amount: true,
                  classification: true,
                },
                orderBy: { createdAt: 'desc' },
              },
            },
            orderBy: [
              { customer: { customerCode: 'asc' } },
              { accountCode: 'asc' },
            ],
          })
        : [];

    const customers = new Map<string, RouteView['customers'][number]>();
    for (const account of accounts) {
      const entry = customers.get(account.customer.id) ?? {
        customerId: account.customer.id,
        customerCode: account.customer.customerCode,
        name: account.customer.name,
        address: account.customer.address,
        mobile: account.customer.mobile,
        accounts: [],
      };
      const collected = account.collections[0];
      entry.accounts.push({
        accountLoanId: account.id,
        accountCode: account.accountCode,
        expectedAmount: capExpectedAmount(
          account.dailyAmount.toString(),
          account.outstandingAmount.toString(),
        ).toFixed(2),
        outstandingAmount: toMoney(
          account.outstandingAmount.toString(),
        ).toFixed(2),
        dailyAmount: toMoney(account.dailyAmount.toString()).toFixed(2),
        daysRemaining: account._count.schedules,
        collectedToday: collected
          ? {
              amount: toMoney(collected.amount.toString()).toFixed(2),
              classification:
                collected.classification === 'CORRECT' ||
                collected.classification === 'LOW' ||
                collected.classification === 'EXTRA'
                  ? collected.classification
                  : 'NO_PAYMENT',
            }
          : null,
        includedKeys: account.collections.map((c) => c.idempotencyKey),
      });
      customers.set(account.customer.id, entry);
    }

    return {
      businessDate: today,
      day: dayKind,
      lineId: context.currentLineId,
      customers: [...customers.values()],
    };
  }
}
