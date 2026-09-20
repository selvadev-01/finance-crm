import type { PrismaClient } from '@repo/db';
import type {
  EmailMessage,
  EmailProvider,
  EmailResult,
} from '@repo/notifications';
import type { PinoLogger } from 'nestjs-pino';

import { EmailDispatchService } from '../../src/email/email-dispatch.service.js';
import { EmailOutbox } from '../../src/email/email-outbox.js';
import {
  escapeHtml,
  notificationEmail,
  passwordResetEmail,
  welcomeEmail,
} from '../../src/email/email-templates.js';
import type { AppConfig } from '../../src/platform/config/config.js';
import { Database } from '../../src/platform/database/database.js';
import { cashWorld } from '../cash/world.js';
import { createTestPrismaClient } from '../database.js';
import { testNotifications } from '../notifications/notices.js';
import { withRollback } from '../with-rollback.js';

/**
 * Email (notifications.md#email) against real rows, rolled back: what is
 * queued and when, and each delivery outcome recorded on the row. The SMTP
 * provider is a fake; its own classification is tested in
 * `@repo/notifications`.
 */
describe('email (M10, notifications.md#email)', () => {
  let prisma: PrismaClient;

  beforeAll(() => {
    prisma = createTestPrismaClient();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  const silent = { warn: () => undefined } as unknown as PinoLogger;

  /** A provider that answers per recipient, and records what it was asked to send. */
  function fakeSmtp(answers: Record<string, EmailResult> = {}) {
    const sent: EmailMessage[] = [];
    const provider: EmailProvider = {
      name: 'SMTP',
      send: async (message) => {
        sent.push(message);
        return answers[message.to] ?? { status: 'sent' };
      },
    };
    return { provider, sent };
  }

  async function world(tx: PrismaClient) {
    const w = await cashWorld(tx);
    const database = new Database(tx);
    const smtp = testNotifications(database, 'NONE', 'SMTP');
    const alert = (
      recipients: string[],
      category: 'ALERT' | 'WARNING' = 'ALERT',
    ) =>
      database.transaction(() =>
        smtp.notifications.raise({
          recipients,
          category,
          eventType:
            category === 'ALERT' ? 'LOW_COLLECTION' : 'EXTRA_COLLECTION',
          title: 'Low collection on Line 3',
          body: 'Suresh collected ₹80.00 of ₹100.00 from Guru',
          link: {
            entityType: 'collection',
            entityId: 'col_1',
            url: '/collections/col_1',
          },
        }),
      );
    const email = (userId: string) =>
      tx.user.findUniqueOrThrow({
        where: { id: userId },
        select: { email: true },
      });
    return { w, database, smtp, alert, email };
  }

  describe('queueing', () => {
    it('refuses to queue outside a transaction', async () => {
      await withRollback(prisma, async (tx) => {
        // Database over the base client, as a service outside a transaction sees it.
        const outbox = new EmailOutbox(new Database(prisma), {
          EMAIL_PROVIDER: 'SMTP',
        } as AppConfig);
        const w = await cashWorld(tx);
        await expect(
          outbox.queue({
            organizationId: w.organizationId,
            userId: w.senior.userId,
            kind: 'WELCOME',
            content: { subject: 'S', text: 'T', html: '<p>T</p>' },
          }),
        ).rejects.toMatchObject({ code: 'EMAIL_OUTSIDE_TRANSACTION' });
      });
    });

    it('emails an ALERT with the notification, its text and an absolute link; not a WARNING', async () => {
      await withRollback(prisma, async (tx) => {
        const { w, alert } = await world(tx);

        await alert([w.senior.userId]);
        await alert([w.senior.userId], 'WARNING');

        const rows = await tx.emailOutbox.findMany({
          where: { userId: w.senior.userId },
          include: { notification: true },
        });
        expect(rows).toHaveLength(1);
        expect(rows[0]).toMatchObject({
          organizationId: w.organizationId,
          kind: 'NOTIFICATION',
          status: 'PENDING',
          attempts: 0,
          subject: `Low collection on Line 3 — Rasi Test`,
          notification: {
            category: 'ALERT',
            title: 'Low collection on Line 3',
          },
        });
        expect(rows[0]!.textBody).toContain(
          'Suresh collected ₹80.00 of ₹100.00 from Guru',
        );
        expect(rows[0]!.textBody).toContain(
          'https://rasi.example/collections/col_1',
        );
      });
    });

    it('queues nothing with EMAIL_PROVIDER=NONE, while the notification is still raised', async () => {
      await withRollback(prisma, async (tx) => {
        const { w, database } = await world(tx);
        const quiet = testNotifications(database);
        await database.transaction(() =>
          quiet.notifications.raise({
            recipients: [w.senior.userId],
            category: 'ALERT',
            eventType: 'LOW_COLLECTION',
            title: 'T',
            body: 'B',
            link: { entityType: null, entityId: null, url: '/' },
          }),
        );
        expect(
          await tx.notification.count({ where: { userId: w.senior.userId } }),
        ).toBe(1);
        expect(
          await tx.emailOutbox.count({ where: { userId: w.senior.userId } }),
        ).toBe(0);
      });
    });
  });

  describe('dispatch', () => {
    const later = (minutes: number) => new Date(Date.now() + minutes * 60_000);
    /** The run's clock: a few minutes after the test queues its rows, so they are due. */
    let now: Date;
    beforeEach(() => {
      now = later(5);
    });

    it('sends to the recipient’s current address and records SENT', async () => {
      await withRollback(prisma, async (tx) => {
        const { w, database, alert, email } = await world(tx);
        await alert([w.senior.userId]);
        // The address changed after the email was queued: the new one is used.
        await tx.user.update({
          where: { id: w.senior.userId },
          data: { email: `moved-${w.senior.userId}@rasi.test` },
        });
        const smtp = fakeSmtp();

        const report = await new EmailDispatchService(
          database,
          smtp.provider,
          silent,
        ).dispatch({ organizationId: w.organizationId, runId: 'run_1' }, now);

        expect(report).toEqual({ sent: 1, retrying: 0, failed: 0, expired: 0 });
        expect(smtp.sent).toEqual([
          expect.objectContaining({
            to: (await email(w.senior.userId)).email,
            subject: `Low collection on Line 3 — Rasi Test`,
            text: expect.stringContaining('Suresh collected'),
            html: expect.stringContaining('<h1'),
          }),
        ]);
        expect(
          await tx.emailOutbox.findFirstOrThrow({
            where: { userId: w.senior.userId },
          }),
        ).toMatchObject({
          status: 'SENT',
          attempts: 1,
          sentAt: now,
          lastError: null,
          nextAttemptAt: null,
        });
      });
    });

    it('retries a temporary refusal with backoff, and fails a permanent one with the reply', async () => {
      await withRollback(prisma, async (tx) => {
        const { w, database, alert, email } = await world(tx);
        await alert([w.senior.userId, w.junior.userId]);
        const smtp = fakeSmtp({
          [(await email(w.senior.userId)).email]: {
            status: 'retry',
            reason: '421 try later',
          },
          [(await email(w.junior.userId)).email]: {
            status: 'failed',
            reason: '550 no such mailbox',
          },
        });

        const report = await new EmailDispatchService(
          database,
          smtp.provider,
          silent,
        ).dispatch({ organizationId: w.organizationId, runId: 'run_1' }, now);

        expect(report).toEqual({ sent: 0, retrying: 1, failed: 1, expired: 0 });
        expect(
          await tx.emailOutbox.findFirstOrThrow({
            where: { userId: w.senior.userId },
          }),
        ).toMatchObject({
          status: 'PENDING',
          attempts: 1,
          lastError: '421 try later',
          nextAttemptAt: new Date(now.getTime() + 60_000),
        });
        expect(
          await tx.emailOutbox.findFirstOrThrow({
            where: { userId: w.junior.userId },
          }),
        ).toMatchObject({
          status: 'FAILED',
          lastError: '550 no such mailbox',
          nextAttemptAt: null,
        });
      });
    });

    it('does not send a row before its next attempt, nor another organization’s', async () => {
      await withRollback(prisma, async (tx) => {
        const { w, database, alert } = await world(tx);
        await alert([w.senior.userId]);
        await tx.emailOutbox.updateMany({
          where: { userId: w.senior.userId },
          data: { nextAttemptAt: later(30) },
        });
        const smtp = fakeSmtp();
        const dispatch = new EmailDispatchService(
          database,
          smtp.provider,
          silent,
        );

        await dispatch.dispatch(
          { organizationId: w.organizationId, runId: 'r' },
          now,
        );
        const other = await cashWorld(tx);
        await dispatch.dispatch(
          { organizationId: other.organizationId, runId: 'r' },
          later(60),
        );

        expect(smtp.sent).toEqual([]);
      });
    });

    it('expires the email of someone no longer active, without sending it', async () => {
      await withRollback(prisma, async (tx) => {
        const { w, database, alert } = await world(tx);
        await alert([w.senior.userId]);
        await tx.staffProfile.update({
          where: { userId: w.senior.userId },
          data: { status: 'SUSPENDED' },
        });
        const smtp = fakeSmtp();

        const report = await new EmailDispatchService(
          database,
          smtp.provider,
          silent,
        ).dispatch({ organizationId: w.organizationId, runId: 'r' }, now);

        expect(report.expired).toBe(1);
        expect(smtp.sent).toEqual([]);
        expect(
          await tx.emailOutbox.findFirstOrThrow({
            where: { userId: w.senior.userId },
          }),
        ).toMatchObject({ status: 'EXPIRED' });
      });
    });

    it('leaves queued email alone while no provider is configured', async () => {
      await withRollback(prisma, async (tx) => {
        const { w, database, alert } = await world(tx);
        await alert([w.senior.userId]);

        const report = await new EmailDispatchService(
          database,
          null,
          silent,
        ).dispatch({ organizationId: w.organizationId, runId: 'r' }, now);

        expect(report).toEqual({ sent: 0, retrying: 0, failed: 0, expired: 0 });
        expect(
          await tx.emailOutbox.findFirstOrThrow({
            where: { userId: w.senior.userId },
          }),
        ).toMatchObject({ status: 'PENDING', attempts: 0 });
      });
    });
  });

  describe('templates', () => {
    it('escapes every interpolated value in the HTML part', () => {
      const email = notificationEmail({
        title: '<script>alert(1)</script>',
        body: 'A & B "quoted"',
        url: 'https://rasi.example/x?a=1&b=2',
        organizationName: "Ganesh's Chits",
      });
      expect(email.html).not.toContain('<script>');
      expect(email.html).toContain('&lt;script&gt;');
      expect(email.html).toContain('A &amp; B &quot;quoted&quot;');
      expect(email.html).toContain('href="https://rasi.example/x?a=1&amp;b=2"');
      expect(escapeHtml(`'`)).toBe('&#39;');
    });

    it('tells a Junior how long the reset link lasts and that ignoring it changes nothing (US-003)', () => {
      const email = passwordResetEmail({
        name: 'Meena',
        resetUrl: 'https://rasi.example/reset-password?token=abc',
        validForMinutes: 30,
      });
      expect(email.subject).toBe('Set a new Rasi password');
      expect(email.text).toContain('lasts 30 minutes');
      expect(email.text).toContain('your password stays as it is');
      expect(email.html).toContain(
        'href="https://rasi.example/reset-password?token=abc"',
      );
    });

    it('keeps the subject on one header line', () => {
      const email = welcomeEmail({
        ownerName: 'Owner',
        organizationName: 'Lakshmi\r\nBcc: someone@example.com',
        signInUrl: 'https://rasi.example/lakshmi/sign-in',
      });
      expect(email.subject).not.toMatch(/[\r\n]/);
      expect(email.text).toContain('https://rasi.example/lakshmi/sign-in');
    });
  });
});
