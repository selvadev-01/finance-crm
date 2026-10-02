import type { PrismaClient } from '@repo/db';
import { randomUUID } from 'node:crypto';

import { AuditWriter } from '../../src/audit/audit.writer.js';
import { sendPasswordReset } from '../../src/auth/password-reset.js';
import { NotificationCentreService } from '../../src/notifications/notification-centre.service.js';
import { templateDefinition } from '../../src/notifications/templates/catalogue.js';
import { NotificationTemplateService } from '../../src/notifications/templates/notification-template.service.js';
import { NotificationTemplates } from '../../src/notifications/templates/notification-templates.js';
import type { AppConfig } from '../../src/platform/config/config.js';
import { Database } from '../../src/platform/database/database.js';
import { cashWorld } from '../cash/world.js';
import { createTestPrismaClient } from '../database.js';
import { withRollback } from '../with-rollback.js';
import { testNotifications } from './notices.js';

/**
 * US-074 message templates against real rows, rolled back: a business's own
 * words reach its staff in each reader's language, its channel choices decide
 * push and email, an alert stays on, every change is audited, and a sent
 * notification keeps the words it was sent with.
 */
describe('message templates (M10, US-074)', () => {
  let prisma: PrismaClient;

  beforeAll(() => {
    prisma = createTestPrismaClient();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  const lowValues = {
    accountCode: 'ACC-7',
    customerName: 'Guru',
    collector: 'Suresh',
    amount: '₹80.00',
    expected: '₹100.00',
  };

  async function world(tx: PrismaClient) {
    const w = await cashWorld(tx);
    const database = new Database(tx);
    const wired = testNotifications(database, 'WEB_PUSH', 'SMTP');
    const manager = new NotificationTemplateService(
      database,
      new AuditWriter(database),
      wired.emails,
      wired.notifications,
      new NotificationTemplates(),
    );
    const raise = (
      template: 'LOW_COLLECTION' | 'EXTRA_COLLECTION' | 'ACCOUNT_COMPLETED',
      recipients: string[],
      values: Record<string, string> = lowValues,
    ) =>
      database.transaction(() =>
        wired.notifications.raise({
          recipients,
          template,
          values,
          link: { entityType: null, entityId: null, url: '/collections/c1' },
        }),
      );
    const device = (userId: string) =>
      tx.pushSubscription.create({
        data: {
          userId,
          provider: 'WEB_PUSH',
          endpoint: `https://fcm.googleapis.com/fcm/send/${randomUUID()}`,
          p256dh: 'p',
          auth: 'a',
          lastSeenAt: new Date(),
        },
      });
    const latest = (userId: string) =>
      tx.notification.findFirstOrThrow({
        where: { userId },
        orderBy: { createdAt: 'desc' },
      });
    const audits = (entityTable: string) =>
      tx.auditLog.findMany({
        where: { organizationId: w.organizationId, entityTable },
        orderBy: { createdAt: 'asc' },
      });
    return { w, database, manager, raise, device, latest, audits };
  }

  const english = templateDefinition('LOW_COLLECTION')!.defaults.EN;

  it("sends the business's own words, in each reader's language, and the Tamil default to a Tamil reader", async () => {
    await withRollback(prisma, async (tx) => {
      const { w, manager, raise, latest } = await world(tx);
      await manager.save(w.owner, 'LOW_COLLECTION', 'EN', {
        ...english,
        title: 'Short at the door · {{accountCode}}',
        body: '{{customerName}} paid {{amount}}; {{expected}} was due',
      });
      await tx.staffProfile.update({
        where: { userId: w.otherSenior.userId },
        data: { language: 'TA' },
      });

      await raise('LOW_COLLECTION', [w.senior.userId, w.otherSenior.userId]);

      expect(await latest(w.senior.userId)).toMatchObject({
        category: 'ALERT',
        eventType: 'LOW_COLLECTION',
        title: 'Short at the door · ACC-7',
        body: 'Guru paid ₹80.00; ₹100.00 was due',
      });
      expect(await latest(w.otherSenior.userId)).toMatchObject({
        title: 'குறைவான வசூல் · ACC-7',
      });
      // The email copy follows the in-app words through {{title}} and {{body}}.
      const email = await tx.emailOutbox.findFirstOrThrow({
        where: { userId: w.senior.userId },
      });
      expect(email.subject).toBe('Short at the door · ACC-7 — Rasi Test');
      expect(email.textBody).toContain('Guru paid ₹80.00; ₹100.00 was due');

      // Another business still reads Rasi's words.
      const other = await world(tx);
      await other.raise('LOW_COLLECTION', [other.w.senior.userId]);
      expect(await other.latest(other.w.senior.userId)).toMatchObject({
        title: 'Low collection · ACC-7',
      });
    });
  });

  it('keeps the words a notification was sent with when the template changes later', async () => {
    await withRollback(prisma, async (tx) => {
      const { w, manager, raise, latest } = await world(tx);
      await raise('LOW_COLLECTION', [w.senior.userId]);
      const sent = await latest(w.senior.userId);
      await manager.save(w.owner, 'LOW_COLLECTION', 'EN', {
        ...english,
        title: 'Changed · {{accountCode}}',
      });
      expect(
        await tx.notification.findUniqueOrThrow({ where: { id: sent.id } }),
      ).toMatchObject({ title: 'Low collection · ACC-7' });
    });
  });

  it('refuses a placeholder the message cannot fill, naming the field, and stores nothing', async () => {
    await withRollback(prisma, async (tx) => {
      const { w, manager } = await world(tx);
      await expect(
        manager.save(w.owner, 'LOW_COLLECTION', 'EN', {
          ...english,
          body: 'Paid by {{customer}}',
          emailHeading: '{{#title}}open',
        }),
      ).rejects.toMatchObject({
        code: 'TEMPLATE_INVALID',
        status: 422,
        details: [
          {
            field: 'body',
            issue: '{{customer}} is not a placeholder of this message',
          },
          {
            field: 'emailHeading',
            issue: '{{#title}} is never closed with {{/title}}',
          },
        ],
      });
      expect(
        await tx.notificationTemplate.count({
          where: { organizationId: w.organizationId },
        }),
      ).toBe(0);
    });
  });

  it('audits a save, an edit and a reset; saving the default words drops the override', async () => {
    await withRollback(prisma, async (tx) => {
      const { w, manager, audits } = await world(tx);
      const edited = { ...english, title: 'Edited · {{accountCode}}' };

      const saved = await manager.save(w.owner, 'LOW_COLLECTION', 'TA', edited);
      expect(saved.overridden).toEqual(['TA']);
      expect(saved.versions.find((v) => v.language === 'TA')).toMatchObject({
        isOverridden: true,
        content: edited,
      });
      await expect(
        manager.save(w.owner, 'LOW_COLLECTION', 'TA', edited),
      ).rejects.toMatchObject({ code: 'TEMPLATE_UNCHANGED' });

      await manager.save(w.owner, 'LOW_COLLECTION', 'TA', {
        ...edited,
        body: 'Edited body {{amount}}',
      });
      const reset = await manager.reset(w.owner, 'LOW_COLLECTION', 'TA');
      expect(reset.overridden).toEqual([]);
      await expect(
        manager.reset(w.owner, 'LOW_COLLECTION', 'TA'),
      ).rejects.toMatchObject({ code: 'TEMPLATE_NOT_OVERRIDDEN' });

      // The default words, saved, are a reset rather than a copy.
      await manager.save(w.owner, 'LOW_COLLECTION', 'EN', edited);
      const back = await manager.save(w.owner, 'LOW_COLLECTION', 'EN', english);
      expect(back.overridden).toEqual([]);

      const rows = await audits('notification_template');
      expect(rows.map((row) => row.action)).toEqual([
        'CREATE',
        'UPDATE',
        'DELETE',
        'CREATE',
        'DELETE',
      ]);
      expect(rows[0]).toMatchObject({
        actorUserId: w.owner.userId,
        after: expect.objectContaining({
          template: 'LOW_COLLECTION',
          language: 'TA',
          title: 'Edited · {{accountCode}}',
        }),
      });
    });
  });

  it('follows the channel choice: a warning emailed, a success pushed, a warning not pushed', async () => {
    await withRollback(prisma, async (tx) => {
      const { w, manager, raise, device, audits } = await world(tx);
      await device(w.senior.userId);
      const pushed = () =>
        tx.notificationOutbox.count({
          where: { notification: { userId: w.senior.userId } },
        });
      const emailed = () =>
        tx.emailOutbox.count({ where: { userId: w.senior.userId } });

      // Defaults: a warning is pushed, not emailed.
      await raise('EXTRA_COLLECTION', [w.senior.userId]);
      expect([await pushed(), await emailed()]).toEqual([1, 0]);

      await manager.updateChannels(w.owner, 'EXTRA_COLLECTION', {
        push: false,
        email: true,
      });
      await raise('EXTRA_COLLECTION', [w.senior.userId]);
      expect([await pushed(), await emailed()]).toEqual([1, 1]);

      await manager.updateChannels(w.owner, 'ACCOUNT_COMPLETED', {
        push: true,
      });
      await raise('ACCOUNT_COMPLETED', [w.senior.userId]);
      expect([await pushed(), await emailed()]).toEqual([2, 1]);

      // The in-app centre got all three whatever the channels.
      expect(
        await tx.notification.count({ where: { userId: w.senior.userId } }),
      ).toBe(3);
      expect(
        (await audits('notification_channel')).map((r) => r.action),
      ).toEqual(['CREATE', 'CREATE']);
    });
  });

  it("refuses to switch off an alert's push or email, and push on an email-only message", async () => {
    await withRollback(prisma, async (tx) => {
      const { w, manager } = await world(tx);
      await expect(
        manager.updateChannels(w.owner, 'LOW_COLLECTION', { email: false }),
      ).rejects.toMatchObject({ code: 'CHANNEL_LOCKED', status: 422 });
      await expect(
        manager.updateChannels(w.owner, 'MISSED_COLLECTION', { push: false }),
      ).rejects.toMatchObject({ code: 'CHANNEL_LOCKED' });
      await expect(
        manager.updateChannels(w.owner, 'PASSWORD_RESET', { push: true }),
      ).rejects.toMatchObject({ code: 'CHANNEL_NOT_AVAILABLE' });
      await expect(
        manager.updateChannels(w.owner, 'PASSWORD_RESET', { email: false }),
      ).rejects.toMatchObject({ code: 'CHANNEL_LOCKED' });
      await expect(
        manager.detail(w.owner, 'NOT_A_MESSAGE'),
      ).rejects.toMatchObject({ code: 'TEMPLATE_NOT_FOUND', status: 404 });
      expect(
        await tx.notificationChannel.count({
          where: { organizationId: w.organizationId },
        }),
      ).toBe(0);
    });
  });

  it('previews unsaved words with sample values, escaped in the email, writing nothing', async () => {
    await withRollback(prisma, async (tx) => {
      const { w, manager } = await world(tx);
      const preview = await manager.preview(
        w.owner,
        'MISSED_COLLECTION',
        'EN',
        {
          ...templateDefinition('MISSED_COLLECTION')!.defaults.EN,
          body: '<b>{{count}}</b> {{#one}}customer{{/one}}{{^one}}customers{{/one}} missed on {{date}}',
        },
      );
      expect(preview.title).toBe('Missed collections · Mylapore A');
      expect(preview.body).toBe('<b>3</b> customers missed on 14 Sep 2026');
      expect(preview.email.html).toContain('&lt;b&gt;3&lt;/b&gt;');
      expect(preview.email.html).toContain(
        'href="https://rasi.example/settings/templates/MISSED_COLLECTION"',
      );
      expect(
        await tx.notificationTemplate.count({
          where: { organizationId: w.organizationId },
        }),
      ).toBe(0);
    });
  });

  it('sends a test to the caller alone — their centre, every device and their inbox — marked Test', async () => {
    await withRollback(prisma, async (tx) => {
      const { w, manager, device, latest } = await world(tx);
      await device(w.owner.userId);
      await device(w.owner.userId);
      // Not pushed by default, but a test shows how the push would look.
      const result = await manager.sendTest(w.owner, 'ACCOUNT_COMPLETED', 'TA');
      expect(result).toEqual({
        inApp: true,
        pushDevices: 2,
        emailQueued: true,
      });
      expect(await latest(w.owner.userId)).toMatchObject({
        title: 'Test · கணக்கு முடிந்தது · ACC-2026-00412',
      });
      const email = await tx.emailOutbox.findFirstOrThrow({
        where: { userId: w.owner.userId },
      });
      expect(email.subject).toMatch(/^Test · /);
      expect(
        await tx.notification.count({ where: { userId: w.senior.userId } }),
      ).toBe(0);

      expect(await manager.sendTest(w.owner, 'PASSWORD_RESET', 'EN')).toEqual({
        inApp: false,
        pushDevices: 0,
        emailQueued: true,
      });
    });
  });

  it("writes the password-reset link in the business's words and the reader's language (US-003)", async () => {
    await withRollback(prisma, async (tx) => {
      const { w, manager } = await world(tx);
      const reset = templateDefinition('PASSWORD_RESET')!.defaults.EN;
      await manager.save(w.owner, 'PASSWORD_RESET', 'EN', {
        ...reset,
        emailSubject: 'Your {{organizationName}} password',
      });
      const send = (userId: string) =>
        sendPasswordReset(tx, {
          userId,
          name: 'Meena',
          url: 'https://rasi.example/reset-password?token=abc',
          emailEnabled: true,
        });

      await send(w.senior.userId);
      await tx.staffProfile.update({
        where: { userId: w.junior.userId },
        data: { language: 'TA' },
      });
      await send(w.junior.userId);

      const subject = async (userId: string) =>
        (
          await tx.emailOutbox.findFirstOrThrow({
            where: { userId, kind: 'PASSWORD_RESET' },
          })
        ).subject;
      expect(await subject(w.senior.userId)).toBe('Your Rasi Test password');
      expect(await subject(w.junior.userId)).toBe(
        'புதிய Rasi கடவுச்சொல்லை அமைக்கவும்',
      );
    });
  });

  it('lets each person choose their language, and reports a category emailed once one of its messages is', async () => {
    await withRollback(prisma, async (tx) => {
      const { w, database, manager } = await world(tx);
      const centre = new NotificationCentreService(database, {
        PUSH_PROVIDER: 'WEB_PUSH',
        EMAIL_PROVIDER: 'SMTP',
      } as AppConfig);

      const before = await centre.preferences(w.junior);
      expect(before.language).toBe('EN');
      expect(
        before.categories.find((c) => c.category === 'WARNING')?.emailed,
      ).toBe(false);

      await manager.updateChannels(w.owner, 'EXTRA_COLLECTION', {
        email: true,
      });
      const after = await centre.updatePreferences(w.junior, {
        language: 'TA',
      });
      expect(after.language).toBe('TA');
      expect(
        after.categories.find((c) => c.category === 'WARNING')?.emailed,
      ).toBe(true);
    });
  });
});
