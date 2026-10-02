import type { PrismaClient } from '@repo/db';
import { addCalendarDays, parseCalendarDate } from '@repo/domain';
import type { PinoLogger } from 'nestjs-pino';
import { randomUUID } from 'node:crypto';

import { OverdueService } from '../../src/accounts/overdue.service.js';
import { AuditWriter } from '../../src/audit/audit.writer.js';
import { IdempotencyPurgeService } from '../../src/collections/idempotency-purge.service.js';
import { JobStatusRecorder } from '../../src/jobs/job-status.recorder.js';
import { JobsService } from '../../src/jobs/jobs.service.js';
import {
  alertDeadJob,
  runForOrganization,
} from '../../src/jobs/scheduled-jobs.js';
import type { AppConfig } from '../../src/platform/config/config.js';
import { DomainError } from '../../src/platform/errors/errors.js';
import { ReconciliationService } from '../../src/ledger/reconciliation.service.js';
import { StaleSubscriptionService } from '../../src/notifications/stale-subscriptions.service.js';
import type { SystemContext } from '../../src/platform/context/system-context.js';
import { Database } from '../../src/platform/database/database.js';
import { SettingReader } from '../../src/settings/setting-reader.js';
import { cashWorld } from '../cash/world.js';
import { createTestPrismaClient } from '../database.js';
import { testNotifications } from '../notifications/notices.js';
import { withRollback } from '../with-rollback.js';

/**
 * The scheduled jobs' handlers (M14) against real rows, rolled back. Every
 * handler runs twice: pg-boss delivers at least once, so a second run must
 * change nothing (M14 job design rules).
 */
describe('scheduled job handlers (M14, US-095)', () => {
  let prisma: PrismaClient;

  beforeAll(() => {
    prisma = createTestPrismaClient();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  async function jobs(tx: PrismaClient) {
    const w = await cashWorld(tx);
    const database = new Database(tx);
    const errors: string[] = [];
    const logger = {
      error: (_: object, message: string) => errors.push(message),
    } as unknown as PinoLogger;
    const system: SystemContext = {
      organizationId: w.organizationId,
      runId: `run_${randomUUID()}`,
    };
    return {
      w,
      system,
      errors,
      reconciliation: new ReconciliationService(
        database,
        new AuditWriter(database),
        logger,
        testNotifications(database).notices,
      ),
      overdue: new OverdueService(
        database,
        new SettingReader(database),
        testNotifications(database).notices,
      ),
      purge: new IdempotencyPurgeService(database),
      stale: new StaleSubscriptionService(database),
      database,
      logger,
      notices: testNotifications(database).notices,
      recorder: new JobStatusRecorder(database),
    };
  }

  describe('US-095 nightly reconciliation', () => {
    it('US-035: a written-off account reconciles to nothing — the cleared receivable is not read as money collected', async () => {
      await withRollback(prisma, async (tx) => {
        const { w, system, reconciliation, errors } = await jobs(tx);
        const account = await w.account('100');
        await w.collect(account.id, '100');
        await w.accounts.close(
          w.admin,
          account.id,
          { status: 'WRITTEN_OFF', note: 'Left the area' },
          parseCalendarDate('2026-01-05'),
        );

        // Twice: the second run must find nothing either (M14 job rules).
        for (let run = 0; run < 2; run += 1) {
          const report = await reconciliation.reconcile(system);
          expect(report.accountMismatches, `run ${run}`).toEqual([]);
          expect(report.unearnedMismatch, `run ${run}`).toBeNull();
        }
        expect(errors).toEqual([]);
      });
    });

    it('Scenario: cached balances are verified — a clean ledger reconciles to nothing, twice', async () => {
      await withRollback(prisma, async (tx) => {
        const { w, system, reconciliation, errors } = await jobs(tx);
        const account = await w.account('100');
        await w.collect(account.id, '100');
        await w.collect((await w.account('150')).id, '120');

        for (let run = 0; run < 2; run += 1) {
          const report = await reconciliation.reconcile(system);
          expect(report.ledgerAccountsChecked).toBeGreaterThan(0);
          expect(report).toMatchObject({
            rebuilt: [],
            accountMismatches: [],
            unearnedMismatch: null,
          });
        }
        expect(errors).toEqual([]);
        expect(
          await tx.notification.count({
            where: {
              eventType: 'RECONCILIATION_MISMATCH',
              userId: w.admin.userId,
            },
          }),
        ).toBe(0);
      });
    });

    it('a drifted ledger balance is recomputed from its entries, audited as a system action, and a second run finds nothing', async () => {
      await withRollback(prisma, async (tx) => {
        const { w, system, reconciliation, errors } = await jobs(tx);
        const account = await w.account('100');
        await w.collect(account.id, '100');
        const cash = await tx.ledgerAccount.findFirstOrThrow({
          where: { ownerUserId: w.junior.userId },
        });
        await tx.ledgerAccount.update({
          where: { id: cash.id },
          data: { balance: '999.99' },
        });

        const report = await reconciliation.reconcile(system);
        expect(report.rebuilt).toEqual([
          {
            ledgerAccountId: cash.id,
            accountType: 'CASH_IN_HAND',
            cached: '999.99',
            fromEntries: '100.00',
          },
        ]);
        const after = await tx.ledgerAccount.findUniqueOrThrow({
          where: { id: cash.id },
        });
        expect(after.balance.toFixed(2)).toBe('100.00');
        const audit = await tx.auditLog.findFirstOrThrow({
          where: { entityTable: 'ledger_account', entityId: cash.id },
        });
        expect(audit).toMatchObject({ actorUserId: null, action: 'UPDATE' });
        expect(audit.after).toMatchObject({
          balance: '100.00',
          systemRun: system.runId,
        });
        expect(errors).toHaveLength(1);
        // One ALERT per run to the organization's Admins (M10, decided 2026-09-14).
        const alerts = () =>
          tx.notification.findMany({
            where: {
              eventType: 'RECONCILIATION_MISMATCH',
              userId: w.admin.userId,
            },
          });
        expect(await alerts()).toEqual([
          expect.objectContaining({
            category: 'ALERT',
            body: expect.stringContaining('1 ledger balance rebuilt'),
          }),
        ]);

        expect((await reconciliation.reconcile(system)).rebuilt).toEqual([]);
        expect(await alerts()).toHaveLength(1);
      });
    });

    it('an account whose collected amount disagrees with the ledger is reported and audited, never changed', async () => {
      await withRollback(prisma, async (tx) => {
        const { w, system, reconciliation } = await jobs(tx);
        const account = await w.account('100');
        await w.collect(account.id, '100');
        // A = 2,000; the ledger says 100 collected. Corrupt the cache to 300.
        await tx.accountLoan.update({
          where: { id: account.id },
          data: { collectedAmount: '300.00', outstandingAmount: '1700.00' },
        });

        const report = await reconciliation.reconcile(system);
        expect(report.accountMismatches).toEqual([
          {
            accountLoanId: account.id,
            accountCode: account.accountCode,
            collectedAmount: '300.00',
            outstandingAmount: '1700.00',
            collectedFromLedger: '100.00',
          },
        ]);
        const unchanged = await tx.accountLoan.findUniqueOrThrow({
          where: { id: account.id },
        });
        expect(unchanged.collectedAmount.toFixed(2)).toBe('300.00');
        expect(
          await tx.auditLog.count({
            where: {
              entityTable: 'account_loan',
              entityId: account.id,
              actorUserId: null,
            },
          }),
        ).toBe(1);
        // Reported again until someone fixes the cause.
        expect(
          (await reconciliation.reconcile(system)).accountMismatches,
        ).toHaveLength(1);
      });
    });
  });

  it('flag-overdue-accounts: an active account past its target with money outstanding is flagged the next day, and cleared when the target moves out', async () => {
    await withRollback(prisma, async (tx) => {
      const { w, system, overdue } = await jobs(tx);
      const account = await w.account('100');
      const target = parseCalendarDate(account.targetCompletionDate);

      expect(await overdue.flag(system, target)).toEqual({
        flagged: 0,
        cleared: 0,
      });
      const dayAfter = addCalendarDays(target, 1);
      expect(await overdue.flag(system, dayAfter)).toEqual({
        flagged: 1,
        cleared: 0,
      });
      expect(await overdue.flag(system, dayAfter)).toEqual({
        flagged: 0,
        cleared: 0,
      });
      expect(
        (await tx.accountLoan.findUniqueOrThrow({ where: { id: account.id } }))
          .isOverdue,
      ).toBe(true);

      // US-033: the line’s Senior hears it once, as a WARNING, with a count
      // rather than one notice per account. A second run flags nothing, so it
      // says nothing more.
      const senior = await tx.notification.findMany({
        where: { userId: w.senior.userId, eventType: 'ACCOUNT_OVERDUE' },
      });
      expect(senior).toHaveLength(1);
      expect(senior[0]).toMatchObject({ category: 'WARNING' });
      expect(senior[0]!.title).toContain('An account is');

      await tx.accountLoan.update({
        where: { id: account.id },
        data: { targetCompletionDate: new Date('2027-01-01') },
      });
      expect(await overdue.flag(system, dayAfter)).toEqual({
        flagged: 0,
        cleared: 1,
      });
    });
  });

  it('purge-idempotency-keys: keys past their 90 days go, younger ones stay, and a second run removes nothing', async () => {
    await withRollback(prisma, async (tx) => {
      const { w, system, purge } = await jobs(tx);
      const key = (expiresAt: string) =>
        tx.idempotencyKey.create({
          data: {
            key: randomUUID(),
            userId: w.junior.userId,
            endpoint: 'POST /api/collections',
            responseBody: {},
            responseStatus: 201,
            expiresAt: new Date(expiresAt),
          },
        });
      const expired = await key('2026-01-01T00:00:00Z');
      const fresh = await key('2026-12-01T00:00:00Z');
      const now = new Date('2026-09-14T20:30:00Z');

      expect(await purge.purge(system, now)).toEqual({ purged: 1 });
      expect(await purge.purge(system, now)).toEqual({ purged: 0 });
      expect(
        await tx.idempotencyKey.findUnique({ where: { key: expired.key } }),
      ).toBeNull();
      expect(
        await tx.idempotencyKey.findUnique({ where: { key: fresh.key } }),
      ).not.toBeNull();
    });
  });
  describe('M10 deactivate-stale-subscriptions', () => {
    const device = (tx: PrismaClient, userId: string, lastSeenAt: Date) =>
      tx.pushSubscription.create({
        data: {
          userId,
          provider: 'WEB_PUSH',
          endpoint: `https://fcm.googleapis.com/fcm/send/${randomUUID()}`,
          p256dh: 'p',
          auth: 'a',
          lastSeenAt,
        },
      });

    it('deactivates a device unseen for 90 days, keeps a recent one, and leaves other organizations alone — twice over', async () => {
      await withRollback(prisma, async (tx) => {
        const { w, system, stale } = await jobs(tx);
        const other = await jobs(tx);
        const now = new Date('2026-09-27T21:30:00Z');
        const days = (n: number) => new Date(now.getTime() - n * 86_400_000);

        const old = await device(tx, w.junior.userId, days(91));
        const recent = await device(tx, w.junior.userId, days(10));
        const elsewhere = await device(tx, other.w.junior.userId, days(200));

        expect(await stale.deactivate(system, now)).toEqual({ deactivated: 1 });
        expect(await stale.deactivate(system, now)).toEqual({ deactivated: 0 });

        const active = async (id: string) =>
          (await tx.pushSubscription.findUniqueOrThrow({ where: { id } }))
            .isActive;
        expect(await active(old.id)).toBe(false);
        expect(await active(recent.id)).toBe(true);
        expect(await active(elsewhere.id)).toBe(true);
      });
    });
  });

  describe('M14 dead-letter alert', () => {
    it("a dead-lettered organization job alerts that organization's Admins, and is logged", async () => {
      await withRollback(prisma, async (tx) => {
        const { w, database, logger, notices, errors, recorder } =
          await jobs(tx);
        const other = await jobs(tx);

        await alertDeadJob(
          database,
          notices,
          logger,
          'reconcile-balances',
          { id: 'job-1', data: { organizationId: w.organizationId } },
          recorder,
        );
        // The job status screen shows when it last failed for good.
        const status = await tx.jobStatus.findUniqueOrThrow({
          where: {
            organizationId_job: {
              organizationId: w.organizationId,
              job: 'reconcile-balances',
            },
          },
        });
        expect(status.deadLetteredAt).not.toBeNull();

        expect(errors).toEqual(['A scheduled job exhausted its retries']);
        const [alert] = await tx.notification.findMany({
          where: { userId: w.admin.userId, eventType: 'JOB_FAILED' },
        });
        expect(alert).toMatchObject({
          category: 'ALERT',
          title: 'Scheduled job failed · Nightly reconciliation',
        });
        for (const userId of [
          w.senior.userId,
          w.junior.userId,
          other.w.admin.userId,
        ]) {
          expect(
            await tx.notification.count({
              where: { userId, eventType: 'JOB_FAILED' },
            }),
          ).toBe(0);
        }
      });
    });

    it('a dead-lettered trigger job belongs to no organization, so it is logged and nobody is notified', async () => {
      await withRollback(prisma, async (tx) => {
        const { w, database, logger, notices, errors, recorder } =
          await jobs(tx);

        await alertDeadJob(
          database,
          notices,
          logger,
          'reconcile-balances',
          { id: 'job-2', data: null },
          recorder,
        );

        expect(errors).toEqual(['A scheduled job exhausted its retries']);
        expect(
          await tx.notification.count({
            where: { userId: w.admin.userId, eventType: 'JOB_FAILED' },
          }),
        ).toBe(0);
      });
    });
  });

  describe('M14 job status', () => {
    const config = {
      WORKER_ENABLED: true,
      JOBS_RECONCILE_CRON: '0 1 * * *',
      JOBS_OVERDUE_CRON: '30 0 * * *',
      JOBS_PURGE_KEYS_CRON: '0 2 * * *',
      JOBS_STALE_SUBSCRIPTIONS_CRON: '0 3 * * 0',
    } as AppConfig;

    it('records a run as it starts and succeeds, and a failure with its code — never its message — then rethrows it', async () => {
      await withRollback(prisma, async (tx) => {
        const { w, system, recorder } = await jobs(tx);
        const logger = { info: () => undefined } as unknown as PinoLogger;
        const status = (job: string) =>
          tx.jobStatus.findUniqueOrThrow({
            where: {
              organizationId_job: { organizationId: w.organizationId, job },
            },
          });

        let seenRunning = false;
        await runForOrganization(
          recorder,
          logger,
          'flag-overdue-accounts',
          async () => {
            seenRunning =
              (await status('flag-overdue-accounts')).lastOutcome === 'RUNNING';
          },
          system,
        );
        expect(seenRunning).toBe(true);
        const done = await status('flag-overdue-accounts');
        expect(done).toMatchObject({
          lastOutcome: 'SUCCEEDED',
          lastError: null,
        });
        expect(done.lastSucceededAt).not.toBeNull();

        const failure = new DomainError(
          'LEDGER_MISMATCH',
          'Account ACC-2026-00412 for Meenakshi Sundaram disagrees',
        );
        await expect(
          runForOrganization(
            recorder,
            logger,
            'reconcile-balances',
            () => Promise.reject(failure),
            system,
          ),
        ).rejects.toBe(failure);
        const failed = await status('reconcile-balances');
        expect(failed).toMatchObject({
          lastOutcome: 'FAILED',
          lastError: 'DomainError LEDGER_MISMATCH',
          lastSucceededAt: null,
        });
      });
    });

    it('lists every scheduled job for the caller’s organization, never-run ones included, and nothing for a Senior', async () => {
      await withRollback(prisma, async (tx) => {
        const { w, system, recorder, database } = await jobs(tx);
        const other = await jobs(tx);
        const logger = { info: () => undefined } as unknown as PinoLogger;
        await runForOrganization(
          recorder,
          logger,
          'purge-idempotency-keys',
          () => Promise.resolve(),
          system,
        );
        await runForOrganization(
          recorder,
          logger,
          'dispatch-emails',
          () => Promise.resolve(),
          other.system,
        );

        const service = new JobsService(config, database);
        const overview = await service.overview(w.admin);
        expect(overview.workerEnabled).toBe(true);
        expect(overview.jobs.map((job) => job.job)).toEqual([
          'reconcile-balances',
          'flag-overdue-accounts',
          'purge-idempotency-keys',
          'dispatch-notifications',
          'dispatch-emails',
          'deactivate-stale-subscriptions',
        ]);
        const byName = new Map(overview.jobs.map((job) => [job.job, job]));
        expect(byName.get('purge-idempotency-keys')).toMatchObject({
          schedule: '0 2 * * *',
          lastOutcome: 'SUCCEEDED',
        });
        // The other organization's run is not ours.
        expect(byName.get('dispatch-emails')).toMatchObject({
          lastOutcome: null,
          lastStartedAt: null,
        });

        const senior = await service.overview(w.senior);
        expect(senior.jobs.every((job) => job.lastOutcome === null)).toBe(true);
      });
    });
  });
});
