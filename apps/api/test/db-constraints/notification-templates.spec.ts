import type { PrismaClient } from '@repo/db';

import { createTestPrismaClient } from '../database.js';
import { withRollback } from '../with-rollback.js';
import { createLine } from './fixtures.js';

/**
 * US-074 message template invariants, migration
 * `constraints_notification_templates`.
 */
describe('notification template constraints (M10, US-074)', () => {
  let prisma: PrismaClient;

  beforeAll(() => {
    prisma = createTestPrismaClient();
  });

  // Every case runs inside withRollback, so nothing reaches the shared schema.
  afterAll(async () => {
    await prisma.$disconnect();
  });

  const words = {
    title: 'Low collection · {{accountCode}}',
    body: '{{collector}} collected {{amount}}',
    emailSubject: '{{title}}',
    emailHeading: '{{title}}',
    emailBody: '{{body}}',
    emailAction: 'View in Rasi',
    emailFooter: 'From Rasi',
  };

  const template = (
    tx: PrismaClient,
    data: Partial<typeof words> & {
      key?: string;
      title?: string | null;
      body?: string | null;
    },
  ) =>
    createLine(tx).then(({ organization }) =>
      tx.notificationTemplate.create({
        data: {
          organizationId: organization.id,
          key: 'LOW_COLLECTION',
          language: 'EN',
          ...words,
          ...data,
        },
      }),
    );

  it('accepts a complete template, and an email-only one with no in-app words', async () => {
    await expect(
      withRollback(prisma, async (tx) => {
        await template(tx, {});
        await template(tx, { key: 'PASSWORD_RESET', title: null, body: null });
      }),
    ).resolves.toBeUndefined();
  });

  it('rejects a key that is not a catalogue key', async () => {
    await expect(
      withRollback(prisma, (tx) => template(tx, { key: 'low collection' })),
    ).rejects.toThrow('notification_template_key_format_check');
  });

  it('rejects a title without a body', async () => {
    await expect(
      withRollback(prisma, (tx) => template(tx, { body: null })),
    ).rejects.toThrow('notification_template_push_pair_check');
  });

  it('rejects a blank part and one over its limit', async () => {
    await expect(
      withRollback(prisma, (tx) => template(tx, { emailAction: '   ' })),
    ).rejects.toThrow('notification_template_length_check');
    await expect(
      withRollback(prisma, (tx) => template(tx, { title: 'x'.repeat(121) })),
    ).rejects.toThrow('notification_template_length_check');
  });

  it('rejects a second template for the same message and language', async () => {
    await expect(
      withRollback(prisma, async (tx) => {
        const first = await template(tx, {});
        await tx.notificationTemplate.create({
          data: {
            organizationId: first.organizationId,
            key: 'LOW_COLLECTION',
            language: 'EN',
            ...words,
          },
        });
      }),
    ).rejects.toThrow(/Unique constraint|organizationId_key_language/);
  });

  it('rejects a channel choice whose key is not a catalogue key', async () => {
    await expect(
      withRollback(prisma, async (tx) => {
        const { organization } = await createLine(tx);
        await tx.notificationChannel.create({
          data: {
            organizationId: organization.id,
            key: 'low-collection',
            push: true,
            email: true,
          },
        });
      }),
    ).rejects.toThrow('notification_channel_key_format_check');
  });
});
