import type { PrismaClient } from '@repo/db';
import { testNotifications } from '../notifications/notices.js';
import { parseCalendarDate, toUtcMidnight } from '@repo/domain';
import type { PinoLogger } from 'nestjs-pino';
import { randomUUID } from 'node:crypto';

import { OverdueService } from '../../src/accounts/overdue.service.js';
import { AuditWriter } from '../../src/audit/audit.writer.js';
import { LineDashboardService } from '../../src/dashboards/line-dashboard.service.js';
import type { SystemContext } from '../../src/platform/context/system-context.js';
import { SettingReader } from '../../src/settings/setting-reader.js';
import { SettingsService } from '../../src/settings/settings.service.js';
import { at } from '../cash/world.js';
import { createTestPrismaClient } from '../database.js';
import { businessWorld } from '../dashboards/business-world.js';
import { testRecorder } from '../security/recorder.js';
import { withRollback } from '../with-rollback.js';

/**
 * BR-05 has **one** definition of overdue, and `account.overdueGraceDays`
 * (M15, US-094) governs all of it: the nightly `isOverdue` flag (M05), the
 * overdue report (M12, US-087) and the Senior line dashboard's overdue list
 * (M11, US-083). Each computes it live from the dates, so the only way they
 * can stay in step is by reading the same setting through the same cutoff —
 * which is what this file exists to hold them to.
 *
 * One real disbursed account on Line A, its target completion date three days
 * past. At grace 0 all three call it overdue; at grace 5 none of them does.
 */
describe('one definition of overdue (BR-05, US-094)', () => {
  let prisma: PrismaClient;

  beforeAll(() => {
    prisma = createTestPrismaClient();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  const TODAY = parseCalendarDate('2026-02-10');
  /** Three days past — overdue with no grace, covered by a grace of five. */
  const TARGET = parseCalendarDate('2026-02-07');
  const NOW = at(TODAY, '11:00:00');
  const page = { limit: 50, sort: 'daysOverdue' } as const;

  async function world(tx: PrismaClient) {
    const w = await businessWorld(tx);
    const account = await w.account(w.line.id, w.north, '500');
    await tx.accountLoan.update({
      where: { id: account.id },
      data: { targetCompletionDate: toUtcMidnight(TARGET) },
    });
    const database = w.database;
    const dashboard = new LineDashboardService(
      database,
      w.dayCloses,
      { error: vi.fn() } as unknown as PinoLogger,
      new SettingReader(database),
    );
    const overdue = new OverdueService(
      database,
      new SettingReader(database),
      testNotifications(database).notices,
    );
    const system: SystemContext = {
      organizationId: w.organizationId,
      runId: `run_${randomUUID()}`,
    };
    const settings = new SettingsService(
      database,
      new AuditWriter(database),
      testRecorder(tx),
    );

    /** The same question, asked of all three, in the order a day runs. */
    const isOverdue = async (minDaysOverdue?: number) => {
      await overdue.flag(system, TODAY);
      const flag = (
        await tx.accountLoan.findUniqueOrThrow({
          where: { id: account.id },
          select: { isOverdue: true },
        })
      ).isOverdue;
      const report = await w.overdue.view(
        w.admin,
        { ...page, minDaysOverdue },
        NOW,
      );
      const view = await dashboard.view(w.admin, { lineId: w.line.id }, NOW);
      if (view.state !== 'LINE') throw new Error('expected a line');
      return {
        flag,
        report: report.data.some((row) => row.accountLoanId === account.id),
        dashboard: (view.overdue?.items ?? []).some(
          (row) => row.accountLoanId === account.id,
        ),
      };
    };

    return { w, account, settings, isOverdue };
  }

  it('Scenario: a target three days past is overdue in the flag, the report and the dashboard at grace 0, and in none of them at grace 5', async () => {
    await withRollback(prisma, async (tx) => {
      const { w, settings, isOverdue } = await world(tx);

      expect(await isOverdue()).toEqual({
        flag: true,
        report: true,
        dashboard: true,
      });

      await settings.update(w.superAdmin, 'account.overdueGraceDays', '5');

      expect(await isOverdue()).toEqual({
        flag: false,
        report: false,
        dashboard: false,
      });
    });
  });

  it('the report’s "overdue by at least n days" filter narrows the graced set and never widens it', async () => {
    await withRollback(prisma, async (tx) => {
      const { w, settings, isOverdue } = await world(tx);

      // Three days past: asking for five or more days leaves it out.
      expect((await isOverdue(5)).report).toBe(false);
      expect((await isOverdue(1)).report).toBe(true);

      await settings.update(w.superAdmin, 'account.overdueGraceDays', '5');

      // The grace period decides who is overdue at all; a filter of "at least
      // one day" cannot drag back an account the grace is still covering.
      expect((await isOverdue(1)).report).toBe(false);
    });
  });
});
