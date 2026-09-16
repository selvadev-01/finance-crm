import type { PrismaClient } from '@repo/db';
import type { PushProvider, PushResult } from '@repo/notifications';
import type { PinoLogger } from 'nestjs-pino';
import { randomUUID } from 'node:crypto';

import { AuditWriter } from '../../src/audit/audit.writer.js';
import { AccountSettlement } from '../../src/collections/account-settlement.js';
import { CollectionHistoryService } from '../../src/collections/collection-history.service.js';
import { CorrectionService } from '../../src/collections/correction.service.js';
import { EmailOutbox } from '../../src/email/email-outbox.js';
import { LedgerService } from '../../src/ledger/ledger.service.js';
import { NotificationCentreService } from '../../src/notifications/notification-centre.service.js';
import { NotificationService } from '../../src/notifications/notification.service.js';
import { PushDispatchService } from '../../src/notifications/push-dispatch.service.js';
import type { AppConfig } from '../../src/platform/config/config.js';
import { Database } from '../../src/platform/database/database.js';
import { at, cashWorld, counts, MONDAY } from '../cash/world.js';
import { createTestPrismaClient } from '../database.js';
import { withRollback } from '../with-rollback.js';

/**
 * M10 against real rows, rolled back: who is told what (US-072), preferences
 * (US-073), push delivery rows and their outcomes (US-071), and the centre
 * (US-070).
 */
describe('notifications (M10, US-070…US-073)', () => {
  let prisma: PrismaClient;

  beforeAll(() => {
    prisma = createTestPrismaClient();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  const inbox = (tx: PrismaClient, userId: string) =>
    tx.notification.findMany({
      where: { userId },
      orderBy: { createdAt: 'asc' },
    });

  describe('US-072 Senior alerts', () => {
    it("low, extra and no-payment visits reach the line's Senior as ALERT, WARNING and ALERT — never the Junior who recorded them", async () => {
      await withRollback(prisma, async (tx) => {
        const w = await cashWorld(tx);
        await w.collect((await w.account('100', 'Guru')).id, '80');
        await w.collect((await w.account('100', 'Hema')).id, '120');
        await w.collect((await w.account('100', 'Indu')).id, '0');

        const senior = await inbox(tx, w.senior.userId);
        expect(senior.map((n) => [n.eventType, n.category])).toEqual([
          ['LOW_COLLECTION', 'ALERT'],
          ['EXTRA_COLLECTION', 'WARNING'],
          ['NO_PAYMENT_COLLECTION', 'ALERT'],
        ]);
        expect(senior[0]!.body).toMatch(
          /collected ₹80\.00 of ₹100\.00 from Guru$/,
        );
        expect(senior[0]!.payload).toMatchObject({
          entityType: 'collection',
          url: expect.stringMatching(/^\/collections\//),
        });
        expect(await inbox(tx, w.junior.userId)).toEqual([]);
        expect(await inbox(tx, w.admin.userId)).toEqual([]);
      });
    });

    it('an exact collection says nothing; the one that completes an account is a SUCCESS', async () => {
      await withRollback(prisma, async (tx) => {
        const w = await cashWorld(tx);
        const account = await w.account('100');
        await w.collect(account.id, '100');
        expect(await inbox(tx, w.senior.userId)).toEqual([]);

        const rest = await tx.accountLoan.findUniqueOrThrow({
          where: { id: account.id },
        });
        await w.collect(
          account.id,
          rest.outstandingAmount.toFixed(2),
          '2026-01-06',
        );
        const [completed] = await inbox(tx, w.senior.userId);
        expect(completed).toMatchObject({ eventType: 'EXTRA_COLLECTION' });
        expect(
          (await inbox(tx, w.senior.userId)).map((n) => n.eventType),
        ).toContain('ACCOUNT_COMPLETED');
      });
    });

    it('closing a day with unvisited customers sends the Senior one summary, not one alert per customer', async () => {
      await withRollback(prisma, async (tx) => {
        const w = await cashWorld(tx);
        await w.account('100', 'One');
        await w.account('100', 'Two');
        await w.account('100', 'Three');
        await w.synced();
        await w.dayCloses.close(
          w.admin,
          w.line.id,
          MONDAY,
          false,
          at('2026-01-05', '20:00:00'),
        );

        const senior = await inbox(tx, w.senior.userId);
        expect(senior).toHaveLength(1);
        expect(senior[0]).toMatchObject({
          eventType: 'MISSED_COLLECTION',
          category: 'ALERT',
        });
        expect(senior[0]!.body).toContain('3 customers were not visited on');
      });
    });

    it('a late collection that reopens a closed day tells the Senior to re-tally', async () => {
      await withRollback(prisma, async (tx) => {
        const w = await cashWorld(tx);
        const account = await w.account('100');
        await w.synced();
        await w.dayCloses.close(
          w.senior,
          w.line.id,
          MONDAY,
          false,
          at('2026-01-05', '18:00:00'),
        );
        await w.collect(account.id, '100');
        expect(
          (await inbox(tx, w.senior.userId)).map((n) => n.eventType),
        ).toContain('DAY_REOPENED');
      });
    });

    it('cash: the receiver is told of a handover; a short acknowledgement alerts Senior and Admins; a dispute alerts Admins and the other party', async () => {
      await withRollback(prisma, async (tx) => {
        const w = await cashWorld(tx);
        await w.collect((await w.account('500')).id, '500');
        const evening = at('2026-01-05', '19:00:00');

        const first = await w.handovers.handOver(
          w.junior,
          {
            lineId: w.line.id,
            businessDate: MONDAY,
            counts: counts({ 200: 2 }),
            note: 'Short by a note',
          },
          evening,
        );
        expect(
          (await inbox(tx, w.senior.userId)).map((n) => n.eventType),
        ).toEqual(['HANDOVER_SUBMITTED']);
        await w.handovers.dispute(w.senior, first.id, 'Counted 400, not 500');
        expect(
          (await inbox(tx, w.junior.userId)).map((n) => n.eventType),
        ).toEqual(['HANDOVER_DISPUTED']);
        expect(
          (await inbox(tx, w.admin.userId)).map((n) => n.eventType),
        ).toEqual(['HANDOVER_DISPUTED']);

        const second = await w.handovers.handOver(
          w.junior,
          {
            lineId: w.line.id,
            businessDate: MONDAY,
            counts: counts({ 200: 2 }),
            note: 'Still short',
          },
          evening,
        );
        await w.handovers.acknowledge(w.senior, second.id, evening);
        const admin = await inbox(tx, w.admin.userId);
        expect(admin.at(-1)).toMatchObject({
          eventType: 'DAY_CLOSE_DISCREPANCY',
          category: 'ALERT',
        });
        expect(admin.at(-1)!.body).toContain('₹100.00 short of the record');
      });
    });

    it("a Junior's correction asks the line's Senior; the Senior's own goes to the Admins", async () => {
      await withRollback(prisma, async (tx) => {
        const w = await cashWorld(tx);
        const database = new Database(tx);
        const audit = new AuditWriter(database);
        const settlement = new AccountSettlement(database);
        const corrections = new CorrectionService(
          database,
          audit,
          new LedgerService(database),
          settlement,
          new CollectionHistoryService(database),
          w.dayCloses,
          w.notices,
        );
        const first = await w.collect((await w.account('100')).id, '100');
        await corrections.request(w.junior, first.id, {
          correctedAmount: '80',
          reason: 'Counted twice',
        });
        expect(
          (await inbox(tx, w.senior.userId)).map((n) => n.eventType),
        ).toEqual(['APPROVAL_REQUESTED']);

        const second = await w.collect((await w.account('100')).id, '100');
        await corrections.request(w.senior, second.id, {
          correctedAmount: '90',
          reason: 'Wrong note',
        });
        expect(
          (await inbox(tx, w.admin.userId)).map((n) => n.eventType),
        ).toEqual(['APPROVAL_REQUESTED']);
      });
    });
  });

  describe('US-073 preferences', () => {
    it('a switched-off WARNING is not delivered, ALERT always is, and ALERT cannot be switched off', async () => {
      await withRollback(prisma, async (tx) => {
        const w = await cashWorld(tx);
        const centre = new NotificationCentreService(new Database(tx), {
          PUSH_PROVIDER: 'NONE',
        } as AppConfig);
        await centre.updatePreferences(w.senior, {
          categories: [{ category: 'WARNING', enabled: false }],
        });
        await expect(
          centre.updatePreferences(w.senior, {
            categories: [{ category: 'ALERT', enabled: false }],
          }),
        ).rejects.toMatchObject({ code: 'ALERT_ALWAYS_ON', status: 422 });

        await w.collect((await w.account('100')).id, '120');
        await w.collect((await w.account('100')).id, '80');
        expect(
          (await inbox(tx, w.senior.userId)).map((n) => n.eventType),
        ).toEqual(['LOW_COLLECTION']);
        expect((await centre.preferences(w.senior)).categories).toContainEqual({
          category: 'ALERT',
          enabled: true,
          locked: true,
          pushed: true,
          emailed: false,
        });
      });
    });
  });

  describe('US-071 push', () => {
    const device = (tx: PrismaClient, userId: string) =>
      tx.pushSubscription.create({
        data: {
          userId,
          provider: 'WEB_PUSH',
          endpoint: `https://fcm.googleapis.com/fcm/send/${randomUUID()}`,
          p256dh: 'p',
          auth: 'a',
          lastSeenAt: new Date('2026-01-01'),
        },
      });

    function fakeWebPush(answers: Record<string, PushResult>): PushProvider {
      return {
        name: 'WEB_PUSH',
        send: async (target) =>
          target.provider === 'WEB_PUSH'
            ? (answers[target.endpoint] ?? { status: 'sent' })
            : { status: 'failed', reason: 'x' },
      };
    }

    async function pushWorld(tx: PrismaClient) {
      const w = await cashWorld(tx);
      const database = new Database(tx);
      // Raise through a notifier configured for Web Push.
      const config = { PUSH_PROVIDER: 'WEB_PUSH' } as AppConfig;
      const notifications = new NotificationService(
        database,
        config,
        new EmailOutbox(database, config),
      );
      return { w, database, notifications };
    }

    it('an ALERT fans out one delivery row per active device; SUCCESS is not pushed; NONE pushes nothing', async () => {
      await withRollback(prisma, async (tx) => {
        const { w, database, notifications } = await pushWorld(tx);
        await device(tx, w.senior.userId);
        await device(tx, w.senior.userId);
        const raise = (
          category: 'ALERT' | 'SUCCESS',
          service = notifications,
        ) =>
          database.transaction(() =>
            service.raise({
              recipients: [w.senior.userId],
              category,
              eventType:
                category === 'ALERT' ? 'LOW_COLLECTION' : 'ACCOUNT_COMPLETED',
              title: 'Title',
              body: 'Body',
              link: { entityType: null, entityId: null, url: '/' },
            }),
          );
        await raise('ALERT');
        await raise('SUCCESS');
        await raise(
          'ALERT',
          new NotificationService(
            database,
            { PUSH_PROVIDER: 'NONE' } as AppConfig,
            new EmailOutbox(database, { EMAIL_PROVIDER: 'NONE' } as AppConfig),
          ),
        );
        expect(
          await tx.notificationOutbox.count({
            where: { notification: { userId: w.senior.userId } },
          }),
        ).toBe(2);
        expect(
          await tx.notification.count({ where: { userId: w.senior.userId } }),
        ).toBe(3);
      });
    });

    it('Scenario: delivery to all devices — each independently; a gone one is deactivated; push failure never loses the notification', async () => {
      await withRollback(prisma, async (tx) => {
        const { w, database, notifications } = await pushWorld(tx);
        const phone = await device(tx, w.senior.userId);
        const oldTablet = await device(tx, w.senior.userId);
        const flaky = await device(tx, w.senior.userId);
        await database.transaction(() =>
          notifications.raise({
            recipients: [w.senior.userId],
            category: 'ALERT',
            eventType: 'LOW_COLLECTION',
            title: 'Low collection',
            body: 'Collected ₹80.00 of ₹100.00',
            link: { entityType: null, entityId: null, url: '/' },
          }),
        );

        // Delivery rows are due from the moment they are raised.
        const now = new Date(Date.now() + 1_000);
        const dispatch = new PushDispatchService(
          database,
          [
            fakeWebPush({
              [oldTablet.endpoint!]: { status: 'gone', reason: '410' },
              [flaky.endpoint!]: { status: 'retry', reason: '503' },
            }),
          ],
          { warn: () => undefined } as unknown as PinoLogger,
        );
        const report = await dispatch.dispatch(
          { organizationId: w.organizationId, runId: 'run_test' },
          now,
        );
        expect(report).toEqual({
          sent: 1,
          retrying: 1,
          failed: 1,
          deactivated: 1,
        });

        const rows = await tx.notificationOutbox.findMany({
          where: { notification: { userId: w.senior.userId } },
        });
        const byDevice = Object.fromEntries(
          rows.map((row) => [row.pushSubscriptionId, row]),
        );
        expect(byDevice[phone.id]).toMatchObject({
          status: 'SENT',
          attempts: 1,
        });
        expect(byDevice[oldTablet.id]).toMatchObject({
          status: 'FAILED',
          lastError: 'gone: 410',
        });
        expect(byDevice[flaky.id]).toMatchObject({
          status: 'PENDING',
          attempts: 1,
          nextAttemptAt: new Date(now.getTime() + 60_000),
        });
        expect(
          (
            await tx.pushSubscription.findUniqueOrThrow({
              where: { id: oldTablet.id },
            })
          ).isActive,
        ).toBe(false);

        // Not yet due: nothing is sent again.
        expect(
          await dispatch.dispatch(
            { organizationId: w.organizationId, runId: 'run_test' },
            now,
          ),
        ).toEqual({
          sent: 0,
          retrying: 0,
          failed: 0,
          deactivated: 0,
        });
        // The notification is in the centre, unread, whatever push did.
        expect(
          await tx.notification.findFirstOrThrow({
            where: { userId: w.senior.userId },
          }),
        ).toMatchObject({ readAt: null });
      });
    });

    it('only known browser push services are accepted, and a stored unknown endpoint is never sent to', async () => {
      await withRollback(prisma, async (tx) => {
        const { w, database, notifications } = await pushWorld(tx);
        const centre = new NotificationCentreService(database, {
          PUSH_PROVIDER: 'WEB_PUSH',
        } as AppConfig);
        await expect(
          centre.register(w.junior, {
            provider: 'WEB_PUSH',
            endpoint: 'https://10.0.0.5/admin',
            p256dh: 'p',
            auth: 'a',
          }),
        ).rejects.toMatchObject({
          code: 'PUSH_ENDPOINT_NOT_ALLOWED',
          status: 422,
        });
        expect(
          await tx.pushSubscription.count({
            where: { userId: w.junior.userId },
          }),
        ).toBe(0);

        const planted = await tx.pushSubscription.create({
          data: {
            userId: w.senior.userId,
            provider: 'WEB_PUSH',
            endpoint: 'https://internal.example/x',
            p256dh: 'p',
            auth: 'a',
            lastSeenAt: new Date(),
          },
        });
        await database.transaction(() =>
          notifications.raise({
            recipients: [w.senior.userId],
            category: 'ALERT',
            eventType: 'LOW_COLLECTION',
            title: 'Low collection',
            body: 'Body',
            link: { entityType: null, entityId: null, url: '/' },
          }),
        );
        const sent: string[] = [];
        const dispatch = new PushDispatchService(
          database,
          [
            {
              name: 'WEB_PUSH',
              send: async (target) => (
                sent.push(target.provider),
                { status: 'sent' }
              ),
            },
          ],
          { warn: () => undefined } as unknown as PinoLogger,
        );
        const report = await dispatch.dispatch(
          { organizationId: w.organizationId, runId: 'run_test' },
          new Date(Date.now() + 1_000),
        );
        expect(report).toEqual({
          sent: 0,
          retrying: 0,
          failed: 1,
          deactivated: 1,
        });
        expect(sent).toEqual([]);
        expect(
          (
            await tx.pushSubscription.findUniqueOrThrow({
              where: { id: planted.id },
            })
          ).isActive,
        ).toBe(false);
      });
    });

    it("a shared phone signed in by someone else stops carrying the previous user's queued pushes", async () => {
      await withRollback(prisma, async (tx) => {
        const { w, database, notifications } = await pushWorld(tx);
        const centre = new NotificationCentreService(database, {
          PUSH_PROVIDER: 'WEB_PUSH',
        } as AppConfig);
        const phone = {
          provider: 'WEB_PUSH' as const,
          endpoint: `https://fcm.googleapis.com/fcm/send/${randomUUID()}`,
          p256dh: 'p',
          auth: 'a',
        };
        await centre.register(w.senior, phone);
        await database.transaction(() =>
          notifications.raise({
            recipients: [w.senior.userId],
            category: 'ALERT',
            eventType: 'LOW_COLLECTION',
            title: 'Low collection · for the Senior',
            body: 'Collected ₹80.00 of ₹100.00 from Guru',
            link: { entityType: null, entityId: null, url: '/' },
          }),
        );
        const queued = () =>
          tx.notificationOutbox.findMany({
            where: { pushSubscription: { endpoint: phone.endpoint } },
          });
        expect((await queued()).map((row) => row.status)).toEqual(['PENDING']);

        const moved = await centre.register(w.junior, phone);
        expect(
          (
            await tx.pushSubscription.findUniqueOrThrow({
              where: { id: moved.id },
            })
          ).userId,
        ).toBe(w.junior.userId);
        expect((await queued()).map((row) => row.status)).toEqual(['EXPIRED']);

        // Refreshing one's own device keeps what is queued for it.
        await database.transaction(() =>
          notifications.raise({
            recipients: [w.junior.userId],
            category: 'ALERT',
            eventType: 'HANDOVER_DISPUTED',
            title: 'Handover disputed',
            body: 'Body',
            link: { entityType: null, entityId: null, url: '/' },
          }),
        );
        await centre.register(w.junior, phone);
        expect((await queued()).map((row) => row.status).sort()).toEqual([
          'EXPIRED',
          'PENDING',
        ]);
      });
    });
  });

  it("US-070 centre: newest first with the unread count; marking read is the recipient's own; another user's is 404", async () => {
    await withRollback(prisma, async (tx) => {
      const w = await cashWorld(tx);
      await w.collect((await w.account('100', 'First')).id, '80');
      await w.collect((await w.account('100', 'Second')).id, '0');
      const centre = new NotificationCentreService(new Database(tx), {
        PUSH_PROVIDER: 'NONE',
      } as AppConfig);

      const page = await centre.list(w.senior, { limit: 50 });
      expect(page.unreadCount).toBe(2);
      expect(page.data.map((n) => n.eventType)).toEqual([
        'NO_PAYMENT_COLLECTION',
        'LOW_COLLECTION',
      ]);
      expect(page.data[0]!.link).toMatchObject({ entityType: 'collection' });

      await expect(
        centre.markRead(w.junior, page.data[0]!.id),
      ).rejects.toMatchObject({ status: 404 });
      expect(await centre.markRead(w.senior, page.data[0]!.id)).toEqual({
        unreadCount: 1,
      });
      expect(
        (await centre.list(w.senior, { limit: 50, unread: 'true' })).data,
      ).toHaveLength(1);
      expect(await centre.markAllRead(w.senior)).toEqual({ unreadCount: 0 });
    });
  });
});
