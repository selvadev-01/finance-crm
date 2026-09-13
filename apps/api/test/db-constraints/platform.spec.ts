import type { PrismaClient } from '@repo/db';
import { randomUUID } from 'node:crypto';

import { createTestPrismaClient } from '../database.js';
import { withRollback } from '../with-rollback.js';
import { createLine, createUser } from './fixtures.js';

/**
 * Notification, calendar and audit invariants (M10, M13, M15), migration
 * `constraints_platform`.
 */
describe('platform constraints (M10, M13, M15)', () => {
  let prisma: PrismaClient;

  beforeAll(() => {
    prisma = createTestPrismaClient();
  });

  // Every case runs inside withRollback, so nothing reaches the shared schema.
  afterAll(async () => {
    await prisma.$disconnect();
  });

  describe('push_subscription', () => {
    it('accepts a complete Web Push subscription', async () => {
      await expect(
        withRollback(prisma, async (tx) => {
          const user = await createUser(tx);
          await tx.pushSubscription.create({
            data: {
              userId: user.id,
              provider: 'WEB_PUSH',
              endpoint: `https://push.example/${randomUUID()}`,
              p256dh: 'key',
              auth: 'secret',
              lastSeenAt: new Date(),
            },
          });
        }),
      ).resolves.toBeUndefined();
    });

    it('rejects a Web Push subscription missing its keys', async () => {
      await expect(
        withRollback(prisma, async (tx) => {
          const user = await createUser(tx);
          await tx.pushSubscription.create({
            data: {
              userId: user.id,
              provider: 'WEB_PUSH',
              endpoint: `https://push.example/${randomUUID()}`,
              lastSeenAt: new Date(),
            },
          });
        }),
      ).rejects.toThrow('push_subscription_provider_fields_check');
    });

    it('rejects an FCM subscription carrying Web Push fields', async () => {
      await expect(
        withRollback(prisma, async (tx) => {
          const user = await createUser(tx);
          await tx.pushSubscription.create({
            data: {
              userId: user.id,
              provider: 'FCM',
              fcmToken: randomUUID(),
              endpoint: `https://push.example/${randomUUID()}`,
              lastSeenAt: new Date(),
            },
          });
        }),
      ).rejects.toThrow('push_subscription_provider_fields_check');
    });
  });

  describe('holiday', () => {
    it('rejects two business-wide holidays on the same date (BR-02)', async () => {
      await expect(
        withRollback(prisma, async (tx) => {
          const { organization } = await createLine(tx);
          // A date far from any real calendar entry in development data.
          const date = new Date('2199-01-26');
          await tx.holiday.create({
            data: { organizationId: organization.id, date, name: 'First' },
          });
          await tx.holiday.create({
            data: { organizationId: organization.id, date, name: 'Duplicate' },
          });
        }),
      ).rejects.toThrow(
        /Unique constraint failed on the (fields: \(`date`,`sectorId`\)|constraint: `holiday_date_sectorId_key`)/,
      );
    });

    it('accepts a sector holiday on a business-wide holiday date', async () => {
      await expect(
        withRollback(prisma, async (tx) => {
          const { organization, sector } = await createLine(tx);
          const date = new Date('2199-01-27');
          await tx.holiday.create({
            data: {
              organizationId: organization.id,
              date,
              name: 'Business-wide',
            },
          });
          await tx.holiday.create({
            data: {
              organizationId: organization.id,
              date,
              name: 'Sector',
              sectorId: sector.id,
            },
          });
        }),
      ).resolves.toBeUndefined();
    });
  });

  describe('audit_log append-only (M13)', () => {
    async function writeEntry(tx: PrismaClient) {
      return tx.auditLog.create({
        data: {
          entityTable: 'collection',
          entityId: randomUUID(),
          action: 'CREATE',
        },
      });
    }

    it('rejects rewriting an audit entry', async () => {
      await expect(
        withRollback(prisma, async (tx) => {
          const entry = await writeEntry(tx);
          await tx.auditLog.update({
            where: { id: entry.id },
            data: { action: 'DELETE' },
          });
        }),
      ).rejects.toThrow('audit_log_append_only: UPDATE');
    });

    it('rejects deleting an audit entry', async () => {
      await expect(
        withRollback(prisma, async (tx) => {
          const entry = await writeEntry(tx);
          await tx.auditLog.delete({ where: { id: entry.id } });
        }),
      ).rejects.toThrow('audit_log_append_only: DELETE');
    });
  });
});
