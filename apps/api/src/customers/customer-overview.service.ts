import { Injectable } from '@nestjs/common';
import type { CustomerOverview } from '@repo/contracts';
import {
  type CalendarDate,
  toBusinessDate,
  toMoney,
  toUtcMidnight,
} from '@repo/domain';

import { customerScope, foundInScope, inScope } from '../access/scope.js';
import type { RequestContext } from '../platform/context/request-context.js';
import { Database } from '../platform/database/database.js';

/**
 * Customer 360's figures (US-022, M04). Read-only, and no money is stored on
 * the customer: the totals are summed across their accounts at read time,
 * because a customer may hold several (BR-01a) and a stored total would be a
 * cache of a sum of caches.
 */
@Injectable()
export class CustomerOverviewService {
  constructor(private readonly database: Database) {}

  async get(
    context: RequestContext,
    customerId: string,
    today: CalendarDate = toBusinessDate(new Date()),
  ): Promise<CustomerOverview> {
    const tx = this.database.client;
    const day = toUtcMidnight(today);
    const customer = foundInScope(
      await tx.customer.findFirst({
        where: inScope(customerScope(context), {
          id: customerId,
          deletedAt: null,
        }),
        select: { id: true, lineId: true },
      }),
      'customer',
    );

    const accounts = await tx.accountLoan.findMany({
      where: { customerId: customer.id },
      select: { status: true, outstandingAmount: true, collectedAmount: true },
    });

    let outstanding = toMoney('0');
    let collected = toMoney('0');
    const count = { active: 0, completed: 0, other: 0 };
    for (const account of accounts) {
      // Outstanding is what is still owed, so only active accounts carry it;
      // collected counts every account the customer has ever held.
      collected = collected.plus(toMoney(account.collectedAmount.toString()));
      if (account.status === 'ACTIVE') {
        count.active += 1;
        outstanding = outstanding.plus(
          toMoney(account.outstandingAmount.toString()),
        );
      } else if (account.status === 'COMPLETED') {
        count.completed += 1;
      } else {
        count.other += 1;
      }
    }

    // "Current assignment" is the one in effect on today's business date, not
    // merely the one left open (M03).
    const staffing = await tx.lineAssignment.findMany({
      where: {
        lineId: customer.lineId,
        effectiveFrom: { lte: day },
        OR: [{ effectiveTo: null }, { effectiveTo: { gte: day } }],
      },
      select: {
        assignmentRole: true,
        staffProfile: { select: { user: { select: { name: true } } } },
      },
    });

    return {
      accounts: count,
      outstandingTotal: outstanding.toFixed(2),
      collectedTotal: collected.toFixed(2),
      staff: {
        seniorName:
          staffing.find((row) => row.assignmentRole === 'SENIOR')?.staffProfile
            .user.name ?? null,
        juniorNames: staffing
          .filter((row) => row.assignmentRole === 'JUNIOR')
          .map((row) => row.staffProfile.user.name),
      },
    };
  }
}
