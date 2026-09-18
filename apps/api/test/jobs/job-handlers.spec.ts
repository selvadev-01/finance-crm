import type { PrismaClient } from '@repo/db';
import { addCalendarDays, parseCalendarDate } from '@repo/domain';
import type { PinoLogger } from 'nestjs-pino';
import { randomUUID } from 'node:crypto';

import { OverdueService } from '../../src/accounts/overdue.service.js';
import { AuditWriter } from '../../src/audit/audit.writer.js';
import { IdempotencyPurgeService } from '../../src/collections/idempotency-purge.service.js';
import { ReconciliationService } from '../../src/ledger/reconciliation.service.js';
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
      overdue: new OverdueService(database, new SettingReader(database)),
      purge: new IdempotencyPurgeService(database),
    };
  }

  describe('US-095 nightly reconciliation', () => {
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
});
