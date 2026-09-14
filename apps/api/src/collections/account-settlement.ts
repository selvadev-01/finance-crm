import { Injectable } from '@nestjs/common';
import {
  type CalendarDate,
  fromUtcMidnight,
  generateSchedule,
  toMoney,
  toUtcMidnight,
} from '@repo/domain';

import type { RequestContext } from '../platform/context/request-context.js';
import { Database } from '../platform/database/database.js';

type Decimal = ReturnType<typeof toMoney>;

/** The account as a money change finds it, read under the row lock. */
export interface SettlingAccount {
  id: string;
  organizationId: string;
  status: 'PENDING' | 'ACTIVE' | 'COMPLETED' | 'DEFAULTED' | 'WRITTEN_OFF';
  dailyAmount: { toString(): string };
  collectedAmount: { toString(): string };
  outstandingAmount: { toString(): string };
  targetCompletionDate: Date;
  customer: { sectorId: string };
}

export interface Settled {
  status: SettlingAccount['status'];
  collectedAmount: Decimal;
  outstandingAmount: Decimal;
  targetCompletionDate: CalendarDate;
  actualCompletionDate: CalendarDate | null;
  collectedBefore: Decimal;
}

/**
 * What a confirmed money change does to its account, beyond the ledger: the
 * cached balances move, and then exactly one of
 *
 * - **completion** at zero outstanding (BR-05): `COMPLETED`, the completion
 *   date, every pending slot `CANCELLED`;
 * - **the tail regenerated** from the outstanding after `businessDate`
 *   (BR-06), answered slots never touched;
 * - **reopening**, when a negative correction leaves a completed account owing
 *   again (US-044, decided 2026-09-14): `ACTIVE`, no completion date, and a
 *   tail from `businessDate`.
 *
 * Shared by a collection (M07) and an approved correction, so the two can never
 * disagree about the schedule. The caller holds the account row lock and the
 * transaction.
 */
@Injectable()
export class AccountSettlement {
  constructor(private readonly database: Database) {}

  async settle(
    context: RequestContext,
    account: SettlingAccount,
    change: Decimal,
    businessDate: CalendarDate,
  ): Promise<Settled> {
    const tx = this.database.client;
    const collectedBefore = toMoney(account.collectedAmount.toString());
    const collectedAfter = collectedBefore.plus(change);
    const outstandingAfter = toMoney(
      account.outstandingAmount.toString(),
    ).minus(change);
    let status = account.status;
    let target = fromUtcMidnight(account.targetCompletionDate);
    let completedOn: CalendarDate | null = null;

    if (outstandingAfter.isZero()) {
      status = 'COMPLETED';
      completedOn = businessDate;
      await tx.accountSchedule.updateMany({
        where: { accountLoanId: account.id, status: 'PENDING' },
        data: { status: 'CANCELLED' },
      });
    } else {
      if (account.status === 'COMPLETED') status = 'ACTIVE';
      await tx.accountSchedule.deleteMany({
        where: { accountLoanId: account.id, status: 'PENDING' },
      });
      const last = await tx.accountSchedule.aggregate({
        where: { accountLoanId: account.id },
        _max: { sequence: true },
      });
      const tail = generateSchedule({
        outstanding: outstandingAfter,
        dailyAmount: toMoney(account.dailyAmount.toString()),
        after: businessDate,
        holidays: await this.holidaysAfter(account, businessDate),
        firstSequence: (last._max.sequence ?? 0) + 1,
      });
      await tx.accountSchedule.createMany({
        data: tail.map((next) => ({
          accountLoanId: account.id,
          sequence: next.sequence,
          dueDate: toUtcMidnight(next.dueDate),
          expectedAmount: next.expectedAmount.toFixed(2),
          createdByUserId: context.userId,
        })),
      });
      target = tail.at(-1)!.dueDate;
    }

    const reopened = account.status === 'COMPLETED' && status === 'ACTIVE';
    await tx.accountLoan.update({
      where: { id: account.id },
      data: {
        collectedAmount: collectedAfter.toFixed(2),
        outstandingAmount: outstandingAfter.toFixed(2),
        targetCompletionDate: toUtcMidnight(target),
        ...(completedOn
          ? {
              status: 'COMPLETED' as const,
              actualCompletionDate: toUtcMidnight(completedOn),
              isOverdue: false,
            }
          : {}),
        ...(reopened
          ? { status: 'ACTIVE' as const, actualCompletionDate: null }
          : {}),
      },
    });

    return {
      status,
      collectedAmount: collectedAfter,
      outstandingAmount: outstandingAfter,
      targetCompletionDate: target,
      actualCompletionDate: completedOn,
      collectedBefore,
    };
  }

  /** M06: business-wide and sector holidays after `from`. */
  private async holidaysAfter(
    account: SettlingAccount,
    from: CalendarDate,
  ): Promise<Set<CalendarDate>> {
    const rows = await this.database.client.holiday.findMany({
      where: {
        organizationId: account.organizationId,
        date: { gt: toUtcMidnight(from) },
        OR: [{ sectorId: null }, { sectorId: account.customer.sectorId }],
      },
      select: { date: true },
    });
    return new Set(rows.map((row) => fromUtcMidnight(row.date)));
  }
}
