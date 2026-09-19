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

  describe('notifications (constraints_notifications)', () => {
    it('rejects switching ALERT off, and accepts switching SUCCESS off (US-073)', async () => {
      const preference = (category: 'ALERT' | 'SUCCESS') =>
        withRollback(prisma, async (tx) => {
          const user = await createUser(tx);
          await tx.notificationPreference.create({
            data: { userId: user.id, category, enabled: false },
          });
        });
      await expect(preference('ALERT')).rejects.toThrow(
        'notification_preference_alert_always_on_check',
      );
      await expect(preference('SUCCESS')).resolves.toBeUndefined();
    });

    it('rejects a notification with a blank title', async () => {
      await expect(
        withRollback(prisma, async (tx) => {
          const user = await createUser(tx);
          await tx.notification.create({
            data: {
              userId: user.id,
              category: 'ALERT',
              eventType: 'LOW_COLLECTION',
              title: ' ',
              body: 'Collected ₹80 of ₹100',
            },
          });
        }),
      ).rejects.toThrow('notification_text_check');
    });

    it('rejects a failed delivery with no error recorded', async () => {
      await expect(
        withRollback(prisma, async (tx) => {
          const user = await createUser(tx);
          const notification = await tx.notification.create({
            data: {
              userId: user.id,
              category: 'ALERT',
              eventType: 'LOW_COLLECTION',
              title: 'Low collection',
              body: 'Collected ₹80 of ₹100',
            },
          });
          const subscription = await tx.pushSubscription.create({
            data: {
              userId: user.id,
              provider: 'FCM',
              fcmToken: `token-${randomUUID()}`,
              lastSeenAt: new Date(),
            },
          });
          await tx.notificationOutbox.create({
            data: {
              notificationId: notification.id,
              pushSubscriptionId: subscription.id,
              status: 'FAILED',
            },
          });
        }),
      ).rejects.toThrow('notification_outbox_failed_has_error_check');
    });
  });

  describe('email_outbox (constraints_email_outbox)', () => {
    async function email(tx: PrismaClient, data: Record<string, unknown> = {}) {
      const { organization } = await createLine(tx);
      const user = await createUser(tx);
      return tx.emailOutbox.create({
        data: {
          organizationId: organization.id,
          userId: user.id,
          kind: 'WELCOME',
          subject: 'Welcome',
          textBody: 'Hello',
          ...data,
        },
      });
    }

    it('accepts a welcome email with no notification', async () => {
      await expect(
        withRollback(prisma, async (tx) => {
          await email(tx);
        }),
      ).resolves.toBeUndefined();
    });

    it('rejects a notification email that points at no notification', async () => {
      await expect(
        withRollback(prisma, (tx) => email(tx, { kind: 'NOTIFICATION' })),
      ).rejects.toThrow('email_outbox_notification_kind_check');
    });

    it.each([
      [{ status: 'FAILED' }, 'email_outbox_failed_has_error_check'],
      [{ status: 'SENT' }, 'email_outbox_sent_has_timestamp_check'],
      [{ attempts: -1 }, 'email_outbox_attempts_non_negative_check'],
      [{ subject: '  ' }, 'email_outbox_content_check'],
      [{ textBody: '' }, 'email_outbox_content_check'],
    ])('rejects %o', async (data, constraint) => {
      await expect(
        withRollback(prisma, (tx) => email(tx, data)),
      ).rejects.toThrow(constraint);
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
        /Unique constraint failed on the (fields: \(`organizationId`,`date`,`sectorId`\)|constraint: `holiday_organizationId_date_sectorId_key`)/,
      );
    });

    it('accepts a sector holiday on a business-wide holiday date', async () => {
      await expect(
        withRollback(prisma, async (tx) => {
          const { organization, sector } = await createLine(tx);
          // A Tuesday: 27 January 2199 is a Sunday, which holiday_not_sunday_check refuses.
          const date = new Date('2199-01-29');
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

    it('accepts the same business-wide holiday in another organization (ADR-0012)', async () => {
      await expect(
        withRollback(prisma, async (tx) => {
          const date = new Date('2199-01-28');
          for (const { organization } of [
            await createLine(tx),
            await createLine(tx),
          ]) {
            await tx.holiday.create({
              data: { organizationId: organization.id, date, name: 'Both' },
            });
          }
        }),
      ).resolves.toBeUndefined();
    });

    it('rejects a holiday on a Sunday — Sundays are excluded by rule, never stored (M06)', async () => {
      await expect(
        withRollback(prisma, async (tx) => {
          const { organization } = await createLine(tx);
          await tx.holiday.create({
            data: {
              organizationId: organization.id,
              date: new Date('2199-01-27'),
              name: 'Sunday',
            },
          });
        }),
      ).rejects.toThrow(/holiday_not_sunday_check/);
    });

    it('accepts a Saturday, which is a working day', async () => {
      await expect(
        withRollback(prisma, async (tx) => {
          const { organization } = await createLine(tx);
          await tx.holiday.create({
            data: {
              organizationId: organization.id,
              date: new Date('2199-01-26'),
              name: 'Saturday',
            },
          });
        }),
      ).resolves.toBeUndefined();
    });

    it.each(['', '   '])('rejects the blank name %j (US-093)', async (name) => {
      await expect(
        withRollback(prisma, async (tx) => {
          const { organization } = await createLine(tx);
          await tx.holiday.create({
            data: {
              organizationId: organization.id,
              date: new Date('2199-01-30'),
              name,
            },
          });
        }),
      ).rejects.toThrow(/holiday_name_not_blank_check/);
    });
  });

  describe('organization slug (ADR-0012)', () => {
    it('gives an organization created without a slug a random org- slug', async () => {
      await withRollback(prisma, async (tx) => {
        const { organization } = await createLine(tx);
        expect(organization.slug).toMatch(/^org-[0-9a-f]{12}$/);
      });
    });

    it.each(['Has Space', 'UPPER', 'trailing-', '-leading', 'a--b', 'ab'])(
      'rejects the slug %j',
      async (slug) => {
        await expect(
          withRollback(prisma, (tx) =>
            tx.organization.create({
              data: {
                name: 'Bad slug',
                slug,
                timezone: 'Asia/Kolkata',
                currency: 'INR',
              },
            }),
          ),
        ).rejects.toThrow('organization_slug_format_check');
      },
    );

    it('rejects a second organization with the same slug', async () => {
      await expect(
        withRollback(prisma, async (tx) => {
          const { organization } = await createLine(tx);
          await tx.organization.create({
            data: {
              name: 'Copy',
              slug: organization.slug,
              timezone: 'Asia/Kolkata',
              currency: 'INR',
            },
          });
        }),
      ).rejects.toThrow(
        /Unique constraint failed on the (fields: \(`slug`\)|constraint: `organization_slug_key`)/,
      );
    });
  });

  describe('organization-scoped codes (ADR-0012)', () => {
    it('rejects a second sector with the same code in one organization', async () => {
      await expect(
        withRollback(prisma, async (tx) => {
          const { organization, sector } = await createLine(tx);
          await tx.sector.create({
            data: {
              organizationId: organization.id,
              code: sector.code,
              name: 'Duplicate',
            },
          });
        }),
      ).rejects.toThrow(
        /Unique constraint failed on the (fields: \(`organizationId`,`code`\)|constraint: `sector_organizationId_code_key`)/,
      );
    });

    it('rejects a second line with the same code in one organization', async () => {
      await expect(
        withRollback(prisma, async (tx) => {
          const { organization, sector, line } = await createLine(tx);
          await tx.line.create({
            data: {
              organizationId: organization.id,
              sectorId: sector.id,
              code: line.code,
              name: 'Duplicate',
            },
          });
        }),
      ).rejects.toThrow(
        /Unique constraint failed on the (fields: \(`organizationId`,`code`\)|constraint: `line_organizationId_code_key`)/,
      );
    });

    it('accepts the same sector, line and setting keys in two organizations', async () => {
      await expect(
        withRollback(prisma, async (tx) => {
          const code = `SHARED-${randomUUID()}`;
          for (const { organization } of [
            await createLine(tx),
            await createLine(tx),
          ]) {
            const sector = await tx.sector.create({
              data: { organizationId: organization.id, code, name: 'Sector' },
            });
            await tx.line.create({
              data: {
                organizationId: organization.id,
                sectorId: sector.id,
                code,
                name: 'Line',
              },
            });
            await tx.setting.create({
              data: {
                organizationId: organization.id,
                key: `test.${code}`,
                value: 1,
                description: 'Per-organization setting',
              },
            });
          }
        }),
      ).resolves.toBeUndefined();
    });
  });

  describe('audit_log append-only (M13)', () => {
    async function writeEntry(tx: PrismaClient) {
      const { organization } = await createLine(tx);
      return tx.auditLog.create({
        data: {
          organizationId: organization.id,
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

    it('rejects a new entry with no organization, except a sign-in attempt (US-090)', async () => {
      await expect(
        withRollback(prisma, (tx) =>
          tx.auditLog.create({
            data: {
              entityTable: 'customer',
              entityId: randomUUID(),
              action: 'UPDATE',
            },
          }),
        ),
      ).rejects.toThrow('audit_log_organization_check');
      await expect(
        withRollback(prisma, async (tx) => {
          await tx.auditLog.create({
            data: { entityTable: 'user', entityId: 'unknown', action: 'LOGIN' },
          });
        }),
      ).resolves.toBeUndefined();
    });
  });

  /**
   * `security_event` (migration `constraints_security_event`, ADR-0014). The
   * shape of a refusal, and the one thing this table deliberately does *not*
   * have: the append-only trigger its neighbour above carries.
   */
  describe('security_event (M13, ADR-0014)', () => {
    async function event(tx: PrismaClient, data: Record<string, unknown> = {}) {
      const { organization } = await createLine(tx);
      const user = await createUser(tx);
      return tx.securityEvent.create({
        data: {
          organizationId: organization.id,
          actorUserId: user.id,
          actorRole: 'ADMIN',
          kind: 'RANK_GUARD',
          code: 'ROLE_ABOVE_OWN',
          status: 403,
          method: 'POST',
          path: '/api/staff',
          ...data,
        },
      });
    }

    it('accepts a refusal with no target — an attempt can name a role rather than a row', async () => {
      await expect(
        withRollback(prisma, async (tx) => {
          await event(tx, { detail: { attemptedRole: 'SUPER_ADMIN' } });
        }),
      ).resolves.toBeUndefined();
    });

    it('accepts a bare target id, because the guard knows the id and not the table', async () => {
      await expect(
        withRollback(prisma, async (tx) => {
          await event(tx, { targetId: randomUUID() });
        }),
      ).resolves.toBeUndefined();
    });

    it.each([
      [{ status: 200 }, 'security_event_status_refusal_check'],
      [{ status: 500 }, 'security_event_status_refusal_check'],
      [{ method: 'TRACE' }, 'security_event_method_check'],
      [{ path: 'api/staff' }, 'security_event_path_check'],
      [{ code: '  ' }, 'security_event_code_not_blank_check'],
      [
        { targetTable: ' ', targetId: 'x' },
        'security_event_target_table_not_blank_check',
      ],
      [
        { targetTable: 'staff_profile', targetId: '' },
        'security_event_target_id_not_blank_check',
      ],
      [
        { targetTable: 'staff_profile' },
        'security_event_target_table_needs_id_check',
      ],
    ])('rejects %o', async (data, constraint) => {
      await expect(
        withRollback(prisma, (tx) => event(tx, data)),
      ).rejects.toThrow(constraint);
    });

    it('accepts DELETE, unlike audit_log — which is what lets the RBAC matrix suite exist', async () => {
      await expect(
        withRollback(prisma, async (tx) => {
          const row = await event(tx);
          await tx.securityEvent.delete({ where: { id: row.id } });
          expect(await tx.securityEvent.count({ where: { id: row.id } })).toBe(
            0,
          );
        }),
      ).resolves.toBeUndefined();
    });
  });
});
