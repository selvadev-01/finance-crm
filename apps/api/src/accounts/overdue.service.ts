import { Injectable } from '@nestjs/common';
import { type CalendarDate, toUtcMidnight } from '@repo/domain';

import type { SystemContext } from '../platform/context/system-context.js';
import { Database } from '../platform/database/database.js';

/**
 * BR-05 — `isOverdue` is a flag on an `ACTIVE` account, set the day after its
 * target completion date passes with money still outstanding, with no grace
 * period (open question 3). Cleared when that stops being true — a regenerated
 * tail moved the target out, or the account is no longer active.
 *
 * Idempotent: it sets the flag to what the dates say, so a second run changes
 * nothing. Not audited per account — it is a derived flag, recomputed nightly.
 */
@Injectable()
export class OverdueService {
  constructor(private readonly database: Database) {}

  async flag(
    system: SystemContext,
    today: CalendarDate,
  ): Promise<{ flagged: number; cleared: number }> {
    const day = toUtcMidnight(today);
    return this.database.transaction(async (tx) => {
      const flagged = await tx.accountLoan.updateMany({
        where: {
          organizationId: system.organizationId,
          status: 'ACTIVE',
          isOverdue: false,
          outstandingAmount: { gt: 0 },
          targetCompletionDate: { lt: day },
        },
        data: { isOverdue: true },
      });
      const cleared = await tx.accountLoan.updateMany({
        where: {
          organizationId: system.organizationId,
          isOverdue: true,
          OR: [
            { status: { not: 'ACTIVE' } },
            { targetCompletionDate: { gte: day } },
            { outstandingAmount: { lte: 0 } },
          ],
        },
        data: { isOverdue: false },
      });
      return { flagged: flagged.count, cleared: cleared.count };
    });
  }
}
