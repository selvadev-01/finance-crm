import type { PrismaClient } from '@repo/db';
import { addCalendarDays, toBusinessDate } from '@repo/domain';

import { AccountHistoryService } from '../../src/audit/account-history.service.js';
import { AuditLogService } from '../../src/audit/audit-log.service.js';
import { AuditWriter } from '../../src/audit/audit.writer.js';
import { AccountSettlement } from '../../src/collections/account-settlement.js';
import { CollectionHistoryService } from '../../src/collections/collection-history.service.js';
import { CorrectionService } from '../../src/collections/correction.service.js';
import { LedgerService } from '../../src/ledger/ledger.service.js';
import { Database } from '../../src/platform/database/database.js';
import { at, cashWorld, MONDAY } from '../cash/world.js';
import { createTestPrismaClient } from '../database.js';
import { withRollback } from '../with-rollback.js';

/**
 * M13 reads against real rows, rolled back: the audit log (US-090) and an
 * account's history (US-091). Audit rows cannot be deleted, so these are
 * proven here rather than over HTTP.
 */
describe('audit log and account history (M13, US-090, US-091)', () => {
  let prisma: PrismaClient;

  beforeAll(() => {
    prisma = createTestPrismaClient();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  const page = { limit: 50 } as const;

  describe('US-090 audit log', () => {
    it("lists only the caller's organization, newest first, with who did it, before and after", async () => {
      await withRollback(prisma, async (tx) => {
        const w = await cashWorld(tx);
        const other = await cashWorld(tx);
        await other.account('100', 'Elsewhere');
        const account = await w.account('100');
        await w.collect(account.id, '80');
        const log = new AuditLogService(new Database(tx));

        const { data } = await log.list(w.admin, page);
        expect(data.length).toBeGreaterThan(0);
        const otherAccounts = await tx.accountLoan.findMany({
          where: { organizationId: other.organizationId },
        });
        expect(data.map((entry) => entry.entityId)).not.toContain(
          otherAccounts[0]!.id,
        );
        const sorted = [...data].sort((a, b) =>
          b.createdAt.localeCompare(a.createdAt),
        );
        expect(data.map((entry) => entry.createdAt)).toEqual(
          sorted.map((entry) => entry.createdAt),
        );

        const recorded = data.find(
          (entry) => entry.entityTable === 'collection',
        );
        expect(recorded).toMatchObject({
          action: 'CREATE',
          actor: { userId: w.junior.userId, name: expect.any(String) },
          system: false,
          before: null,
          after: expect.objectContaining({ amount: '80.00' }),
        });
        expect(
          data.find(
            (entry) =>
              entry.entityTable === 'account_loan' && entry.action === 'CREATE',
          ),
        ).toMatchObject({
          entityId: account.id,
          actor: { userId: w.admin.userId },
        });
      });
    });

    it('filters by actor, entity, action and business date, and refuses a reversed range', async () => {
      await withRollback(prisma, async (tx) => {
        const w = await cashWorld(tx);
        const account = await w.account('100');
        await w.collect(account.id, '100');
        const log = new AuditLogService(new Database(tx));
        const today = toBusinessDate(new Date());

        const byJunior = await log.list(w.admin, {
          ...page,
          actorUserId: w.junior.userId,
        });
        expect(byJunior.data.length).toBeGreaterThan(0);
        expect(
          byJunior.data.every(
            (entry) => entry.actor?.userId === w.junior.userId,
          ),
        ).toBe(true);

        const forAccount = await log.list(w.admin, {
          ...page,
          entityTable: 'account_loan',
          entityId: account.id,
        });
        expect(forAccount.data.length).toBeGreaterThan(0);
        expect(
          forAccount.data.every((entry) => entry.entityId === account.id),
        ).toBe(true);

        const creates = await log.list(w.admin, { ...page, action: 'CREATE' });
        expect(creates.data.every((entry) => entry.action === 'CREATE')).toBe(
          true,
        );

        expect(
          (await log.list(w.admin, { ...page, from: today, to: today })).data
            .length,
        ).toBeGreaterThan(0);
        expect(
          (
            await log.list(w.admin, {
              ...page,
              from: addCalendarDays(today, 1),
            })
          ).data,
        ).toEqual([]);
        expect(
          (await log.list(w.admin, { ...page, to: addCalendarDays(today, -1) }))
            .data,
        ).toEqual([]);

        await expect(
          log.list(w.admin, {
            ...page,
            from: today,
            to: addCalendarDays(today, -1),
          }),
        ).rejects.toMatchObject({
          code: 'INVALID_DATE_RANGE',
          status: 400,
        });
      });
    });

    it('pages newest first without repeating or skipping an entry', async () => {
      await withRollback(prisma, async (tx) => {
        const w = await cashWorld(tx);
        for (const name of ['One', 'Two', 'Three'])
          await w.account('100', name);
        const log = new AuditLogService(new Database(tx));
        const all = (await log.list(w.admin, page)).data.map(
          (entry) => entry.id,
        );

        const walked: string[] = [];
        let cursor: string | undefined;
        do {
          const next = await log.list(w.admin, {
            limit: 2,
            ...(cursor ? { cursor } : {}),
          });
          walked.push(...next.data.map((entry) => entry.id));
          cursor = next.nextCursor ?? undefined;
        } while (cursor);
        expect(walked).toEqual(all);
        expect(all.length).toBeGreaterThan(2);
      });
    });

    it('labels a scheduled job as a system action with no actor', async () => {
      await withRollback(prisma, async (tx) => {
        const w = await cashWorld(tx);
        const database = new Database(tx);
        await w.account('100');
        const ledgerAccount = await tx.ledgerAccount.findFirstOrThrow({
          where: { organizationId: w.organizationId },
        });
        await database.transaction(() =>
          new AuditWriter(database).recordSystem(
            { organizationId: w.organizationId, runId: 'run_audit' },
            {
              action: 'UPDATE',
              entityTable: 'ledger_account',
              entityId: ledgerAccount.id,
              after: { reconciliation: 'rebuilt' },
            },
          ),
        );
        const { data } = await new AuditLogService(database).list(w.admin, {
          ...page,
          entityTable: 'ledger_account',
        });
        expect(data[0]).toMatchObject({
          actor: null,
          system: true,
          after: { reconciliation: 'rebuilt', systemRun: 'run_audit' },
        });
      });
    });
  });

  describe('US-091 account history', () => {
    it('assembles creation, collections, the day close, and a correction with its approval, in time order', async () => {
      await withRollback(prisma, async (tx) => {
        const w = await cashWorld(tx);
        const database = new Database(tx);
        const audit = new AuditWriter(database);
        const corrections = new CorrectionService(
          database,
          audit,
          new LedgerService(database),
          new AccountSettlement(database),
          new CollectionHistoryService(database),
          w.dayCloses,
          w.notices,
        );
        const account = await w.account('100', 'Guru');
        const monday = await w.collect(account.id, '80');
        await w.synced();
        await w.dayCloses.close(
          w.senior,
          w.line.id,
          MONDAY,
          false,
          at('2026-01-05', '20:00:00'),
        );
        const { id: approvalId } = await corrections.request(
          w.junior,
          monday.id,
          { correctedAmount: '100', reason: 'Counted the second note late' },
          at('2026-01-06'),
        );
        await corrections.decide(
          w.senior,
          approvalId,
          { decision: 'APPROVED', note: 'Paper slip says 100' },
          at('2026-01-06', '11:00:00'),
        );
        await w.dayCloses.reopen(
          w.admin,
          w.line.id,
          MONDAY,
          'Customer disputes Monday',
          at('2026-01-07'),
        );

        const { account: summary, events } = await new AccountHistoryService(
          database,
        ).history(w.admin, account.id);
        expect(summary).toMatchObject({
          id: account.id,
          customerName: 'Guru',
          status: 'ACTIVE',
          actualCompletionDate: null,
        });

        const sorted = [...events].sort((a, b) => a.at.localeCompare(b.at));
        expect(events.map((event) => event.at)).toEqual(
          sorted.map((event) => event.at),
        );

        const audits = events.filter((event) => event.kind === 'AUDIT');
        expect(
          audits.map((event) => [event.entry.entityTable, event.entry.action]),
        ).toEqual(
          expect.arrayContaining([
            ['account_loan', 'CREATE'],
            ['collection', 'APPROVE'],
            // The close and the reopen, which the day_close row alone no longer shows.
            ['day_close', 'UPDATE'],
            ['day_close', 'REOPEN_DAY'],
          ]),
        );
        // A collection's own CREATE entry is not repeated: the collection row is its history (BR-14).
        expect(
          audits.some(
            (event) =>
              event.entry.entityTable === 'collection' &&
              event.entry.action === 'CREATE',
          ),
        ).toBe(false);

        const collected = events.filter((event) => event.kind === 'COLLECTION');
        expect(collected).toEqual([
          expect.objectContaining({
            collectionId: monday.id,
            businessDate: '2026-01-05',
            entryType: 'ORIGINAL',
            amount: '80.00',
            expectedAmount: '100.00',
            variance: '-20.00',
            classification: 'LOW',
            status: 'CONFIRMED',
            collector: { userId: w.junior.userId, name: expect.any(String) },
            approval: null,
          }),
          expect.objectContaining({
            entryType: 'ADJUSTMENT',
            adjustsCollectionId: monday.id,
            amount: '20.00',
            status: 'CONFIRMED',
            approval: expect.objectContaining({
              decision: 'APPROVED',
              reason: 'Counted the second note late',
              requestedBy: {
                userId: w.junior.userId,
                name: expect.any(String),
              },
              decidedBy: { userId: w.senior.userId, name: expect.any(String) },
              decisionNote: 'Paper slip says 100',
            }),
          }),
        ]);

        const closes = events.filter((event) => event.kind === 'DAY_CLOSE');
        expect(closes).toEqual([
          expect.objectContaining({
            businessDate: '2026-01-05',
            lineId: w.line.id,
            status: 'REOPENED',
            reopenReason: 'Customer disputes Monday',
          }),
        ]);
      });
    });

    it("an account outside the caller's organization is 404, identical to a missing one", async () => {
      await withRollback(prisma, async (tx) => {
        const w = await cashWorld(tx);
        const other = await cashWorld(tx);
        const theirs = await other.account('100');
        const history = new AccountHistoryService(new Database(tx));
        await expect(history.history(w.admin, theirs.id)).rejects.toMatchObject(
          { status: 404 },
        );
        await expect(
          history.history(w.admin, 'acc_missing'),
        ).rejects.toMatchObject({ status: 404 });
      });
    });
  });
});
