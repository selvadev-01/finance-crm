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
 * their lines (M02 scope) with a slot due that day, grouped by customer, with
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

    // A Junior may work several lines (decided 2026-10-03), possibly in
    // different sectors, so a sector's holiday rests only that sector's lines.
    const lineRows = await tx.line.findMany({
      where: { id: { in: [...context.currentLineIds] } },
      select: { id: true, sectorId: true, code: true, name: true },
      orderBy: { code: 'asc' },
    });
    const holidays = lineRows.length
      ? await tx.holiday.findMany({
          where: {
            organizationId: context.organizationId,
            date: day,
            OR: [
              { sectorId: null },
              { sectorId: { in: lineRows.map((line) => line.sectorId) } },
            ],
          },
          select: { name: true, sectorId: true },
        })
      : [];
    const holidayOf = (sectorId: string) =>
      holidays.find((h) => h.sectorId === null || h.sectorId === sectorId)
        ?.name ?? null;
    const lines = lineRows.map((line) => ({
      lineId: line.id,
      code: line.code,
      name: line.name,
      holiday: holidayOf(line.sectorId),
    }));
    const working = lines.filter((line) => line.holiday === null);

    let dayKind: RouteView['day'] = { kind: 'WORKING' };
    if (lines.length > 0 && working.length === 0) {
      dayKind = { kind: 'HOLIDAY', name: lines[0]!.holiday! };
    }
    if (dayOfWeek(today) === 0) dayKind = { kind: 'SUNDAY' };

    const accounts =
      dayKind.kind === 'WORKING'
        ? await tx.accountLoan.findMany({
            where: inScope(accountScope(context), {
              status: 'ACTIVE',
              schedules: { some: { dueDate: day } },
              customer: {
                lineId: { in: working.map((line) => line.lineId) },
              },
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
                  lineId: true,
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
            // Line by line, each in its visiting order, set by its Senior or
            // an Admin; the customers not yet placed follow, in code order
            // (US-040).
            orderBy: [
              { customer: { line: { code: 'asc' } } },
              { customer: { routePosition: { sort: 'asc', nulls: 'last' } } },
              { customer: { customerCode: 'asc' } },
              { accountCode: 'asc' },
            ],
          })
        : [];

    const customers = new Map<string, RouteView['customers'][number]>();
    for (const account of accounts) {
      const entry = customers.get(account.customer.id) ?? {
        customerId: account.customer.id,
        lineId: account.customer.lineId,
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
      lines,
      customers: [...customers.values()],
    };
  }
}
