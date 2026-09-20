import { Injectable } from '@nestjs/common';
import { type CalendarDate, toUtcMidnight } from '@repo/domain';

import type { SystemContext } from '../platform/context/system-context.js';
import { Database } from '../platform/database/database.js';
import { EventNotices } from '../notifications/event-notices.js';
import { SettingReader } from '../settings/setting-reader.js';
import { overdueCutoff } from './overdue-cutoff.js';

/**
 * BR-05 — `isOverdue` is a flag on an `ACTIVE` account, set the day after its
 * target completion date passes with money still outstanding. Cleared when
 * that stops being true — a regenerated tail moved the target out, or the
 * account is no longer active.
 *
 * `account.overdueGraceDays` (M15, US-094) shifts the line: zero by default,
 * which is open question 3's answer. Changing it restates nothing — the flag
 * is derived from the dates and recomputed on the next run — so the setting is
 * freely editable, unlike the values a schedule was generated from.
 *
 * The cutoff itself is `overdue-cutoff.ts`, shared with the overdue report
 * (M12) and the line dashboard (M11): all three read the same setting, so the
 * flag and the two live computations always answer the same question.
 *
 * Idempotent: it sets the flag to what the dates say, so a second run changes
 * nothing. Not audited per account — it is a derived flag, recomputed nightly.
 */
@Injectable()
export class OverdueService {
  constructor(
    private readonly database: Database,
    private readonly settings: SettingReader,
    private readonly notices: EventNotices,
  ) {}

  async flag(
    system: SystemContext,
    today: CalendarDate,
  ): Promise<{ flagged: number; cleared: number }> {
    const grace = await this.settings.number(
      system.organizationId,
      'account.overdueGraceDays',
    );
    // An account is behind only once its target is more than `grace` days past.
    const day = toUtcMidnight(overdueCutoff(today, grace));
    return this.database.transaction(async (tx) => {
      // Read the accounts about to flip before flipping them: the Senior of
      // each line is told how many went overdue (US-033), and an updateMany
      // cannot say which rows it touched.
      const going = await tx.accountLoan.findMany({
        where: {
          organizationId: system.organizationId,
          status: 'ACTIVE',
          isOverdue: false,
          outstandingAmount: { gt: 0 },
          targetCompletionDate: { lt: day },
        },
        select: { id: true, customer: { select: { lineId: true } } },
      });
      const flagged = await tx.accountLoan.updateMany({
        where: { id: { in: going.map((account) => account.id) } },
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
      // One notice per line, in this transaction: no flag, no notice.
      const byLine = new Map<string, number>();
      for (const account of going) {
        const lineId = account.customer.lineId;
        byLine.set(lineId, (byLine.get(lineId) ?? 0) + 1);
      }
      for (const [lineId, count] of byLine) {
        await this.notices.accountsOverdue({ lineId, count, today });
      }
      return { flagged: flagged.count, cleared: cleared.count };
    });
  }
}
