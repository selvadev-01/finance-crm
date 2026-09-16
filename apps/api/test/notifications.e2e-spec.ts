import type { INestApplication } from '@nestjs/common';
import type { PrismaClient, StaffRole } from '@repo/db';
import type { Server } from 'node:http';
import request from 'supertest';

import { createTestApp } from './app.js';
import { createTestPrismaClient, deleteTestRunData } from './database.js';
import {
  createTestOrganization,
  createTestStaff,
  signIn,
  type TestStaff,
} from './staff.js';

/**
 * M10 over HTTP (US-070, US-071, US-073). Notifications, push devices and
 * preferences belong to a user and cascade away with the run's staff, so this
 * tier may write them directly. Raising a notification from an event is proven
 * in Tier 1 (`test/notifications/notifications.spec.ts`), because the events
 * themselves write append-only rows.
 */
describe('notifications (M10, e2e)', () => {
  let app: INestApplication<Server>;
  let prisma: PrismaClient;
  const cookies = {} as Record<StaffRole, string>;
  const staff = {} as Record<StaffRole, TestStaff>;
  let outsider: TestStaff;

  const http = () => request(app.getHttpServer());
  const as = (role: StaffRole) => ({
    get: (path: string) => http().get(path).set('Cookie', cookies[role]),
    post: (path: string, body: object = {}) =>
      http().post(path).set('Cookie', cookies[role]).send(body),
    patch: (path: string, body: object) =>
      http().patch(path).set('Cookie', cookies[role]).send(body),
    delete: (path: string) => http().delete(path).set('Cookie', cookies[role]),
  });

  const notify = (userId: string, title: string, readAt: Date | null = null) =>
    prisma.notification.create({
      data: {
        userId,
        category: 'ALERT',
        eventType: 'LOW_COLLECTION',
        title,
        body: 'Collected ₹80.00 of ₹100.00',
        payload: {
          entityType: 'collection',
          entityId: 'col_x',
          url: '/collections/col_x',
        },
        readAt,
      },
    });

  beforeAll(async () => {
    prisma = createTestPrismaClient();
    app = await createTestApp();
    const org = await createTestOrganization(prisma, ['Line A']);
    for (const role of ['SUPER_ADMIN', 'ADMIN', 'SENIOR', 'JUNIOR'] as const) {
      staff[role] = await createTestStaff(prisma, {
        organizationId: org.organization.id,
        role,
      });
      cookies[role] = await signIn(app, staff[role]);
    }
    const other = await createTestOrganization(prisma, ['Line Z']);
    outsider = await createTestStaff(prisma, {
      organizationId: other.organization.id,
      role: 'JUNIOR',
    });
  });

  afterAll(async () => {
    await app.close();
    await deleteTestRunData(prisma);
    await prisma.$disconnect();
  });

  it('US-070: every role reads only its own notifications, newest first, with the unread count', async () => {
    const older = await notify(staff.SENIOR.userId, 'Older');
    const newer = await notify(staff.SENIOR.userId, 'Newer');
    await notify(staff.SENIOR.userId, 'Read already', new Date());
    await notify(staff.JUNIOR.userId, 'Not the Senior’s');

    const page = await as('SENIOR').get('/api/notifications').expect(200);
    expect(page.body.unreadCount).toBe(2);
    expect(page.body.data.map((n: { title: string }) => n.title)).toEqual([
      'Read already',
      'Newer',
      'Older',
    ]);
    expect(page.body.data[1]).toMatchObject({
      id: newer.id,
      category: 'ALERT',
      eventType: 'LOW_COLLECTION',
      link: {
        entityType: 'collection',
        entityId: 'col_x',
        url: '/collections/col_x',
      },
      readAt: null,
    });
    const unread = await as('SENIOR')
      .get('/api/notifications?unread=true')
      .expect(200);
    expect(unread.body.data).toHaveLength(2);

    for (const role of ['SUPER_ADMIN', 'ADMIN'] as const) {
      const empty = await as(role).get('/api/notifications').expect(200);
      expect(empty.body).toMatchObject({ data: [], unreadCount: 0 });
    }
    await as('SENIOR').get('/api/notifications?category=LOUD').expect(400);
    await http().get('/api/notifications').expect(401);

    // Someone else's notification is 404, identical to a missing one.
    await as('JUNIOR').post(`/api/notifications/${older.id}/read`).expect(404);
    await as('SENIOR').post('/api/notifications/ntf_missing/read').expect(404);
    const read = await as('SENIOR')
      .post(`/api/notifications/${older.id}/read`)
      .expect(200);
    expect(read.body).toEqual({ unreadCount: 1 });
    const all = await as('SENIOR')
      .post('/api/notifications/read-all')
      .expect(200);
    expect(all.body).toEqual({ unreadCount: 0 });
    expect(
      await prisma.notification.count({
        where: { userId: staff.JUNIOR.userId, readAt: null },
      }),
    ).toBe(1);
  });

  it('US-071: push config is readable; registering is refused while no provider is enabled; devices are one’s own, and Admins may deregister any in their organization', async () => {
    const config = await as('JUNIOR').get('/api/push/config').expect(200);
    expect(config.body.provider).toEqual(
      expect.stringMatching(/^(WEB_PUSH|FCM|BOTH|NONE)$/),
    );

    const invalid = await as('JUNIOR')
      .post('/api/push-subscriptions', {
        provider: 'WEB_PUSH',
        endpoint: 'http://insecure',
        p256dh: '',
        auth: 'a',
      })
      .expect(400);
    expect(
      invalid.body.details.map((d: { field: string }) => d.field).sort(),
    ).toEqual(['endpoint', 'p256dh']);

    if (config.body.provider === 'NONE') {
      const refused = await as('JUNIOR')
        .post('/api/push-subscriptions', { provider: 'FCM', fcmToken: 'token' })
        .expect(422);
      expect(refused.body.code).toBe('PUSH_PROVIDER_DISABLED');
    }

    const device = (userId: string) =>
      prisma.pushSubscription.create({
        data: {
          userId,
          provider: 'FCM',
          fcmToken: `tok_${userId}`,
          deviceLabel: 'Phone',
          lastSeenAt: new Date(),
        },
      });
    const juniorPhone = await device(staff.JUNIOR.userId);
    const seniorPhone = await device(staff.SENIOR.userId);
    const outsiderPhone = await device(outsider.userId);

    const listed = await as('JUNIOR')
      .get('/api/push-subscriptions')
      .expect(200);
    expect(listed.body.data.map((d: { id: string }) => d.id)).toEqual([
      juniorPhone.id,
    ]);

    await as('JUNIOR')
      .delete(`/api/push-subscriptions/${seniorPhone.id}`)
      .expect(404);
    await as('ADMIN')
      .delete(`/api/push-subscriptions/${outsiderPhone.id}`)
      .expect(404);
    const mine = await as('JUNIOR')
      .delete(`/api/push-subscriptions/${juniorPhone.id}`)
      .expect(200);
    expect(mine.body).toMatchObject({ id: juniorPhone.id, isActive: false });
    const byAdmin = await as('ADMIN')
      .delete(`/api/push-subscriptions/${seniorPhone.id}`)
      .expect(200);
    expect(byAdmin.body.isActive).toBe(false);
    expect(
      (
        await prisma.pushSubscription.findUniqueOrThrow({
          where: { id: outsiderPhone.id },
        })
      ).isActive,
    ).toBe(true);
  });

  it('US-073: every category starts on; WARNING can be switched off, ALERT cannot, and the refusal writes nothing', async () => {
    const initial = await as('JUNIOR')
      .get('/api/notification-preferences')
      .expect(200);
    expect(initial.body.categories).toHaveLength(4);
    expect(initial.body.categories).toEqual(
      expect.arrayContaining([
        {
          category: 'INFORMATION',
          enabled: true,
          locked: false,
          pushed: false,
          emailed: false,
        },
        { category: 'SUCCESS', enabled: true, locked: false, pushed: false, emailed: false },
        { category: 'WARNING', enabled: true, locked: false, pushed: true, emailed: false },
        { category: 'ALERT', enabled: true, locked: true, pushed: true, emailed: false },
      ]),
    );

    const updated = await as('JUNIOR')
      .patch('/api/notification-preferences', {
        categories: [{ category: 'WARNING', enabled: false }],
      })
      .expect(200);
    expect(updated.body.categories).toContainEqual({
      category: 'WARNING',
      enabled: false,
      locked: false,
      pushed: true,
      emailed: false,
    });

    const alert = await as('JUNIOR')
      .patch('/api/notification-preferences', {
        categories: [
          { category: 'SUCCESS', enabled: false },
          { category: 'ALERT', enabled: false },
        ],
      })
      .expect(422);
    expect(alert.body.code).toBe('ALERT_ALWAYS_ON');
    expect(
      await prisma.notificationPreference.count({
        where: { userId: staff.JUNIOR.userId },
      }),
    ).toBe(1);

    await as('JUNIOR')
      .patch('/api/notification-preferences', { categories: [] })
      .expect(400);
    // One user's preferences never touch another's.
    const senior = await as('SENIOR')
      .get('/api/notification-preferences')
      .expect(200);
    expect(
      senior.body.categories.every((c: { enabled: boolean }) => c.enabled),
    ).toBe(true);
  });
});
