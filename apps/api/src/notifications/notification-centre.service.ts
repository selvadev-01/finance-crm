import { Inject, Injectable } from '@nestjs/common';
import type {
  NotificationCategory,
  NotificationPreferences,
  NotificationView,
  PushDevice,
  notificationContract,
  RouteInput,
} from '@repo/contracts';
import type { Prisma } from '@repo/db';
import { isKnownPushEndpoint } from '@repo/notifications';

import { foundInScope } from '../access/scope.js';
import { APP_CONFIG, type AppConfig } from '../platform/config/config.js';
import { EMAILED } from './notification.service.js';
import type { RequestContext } from '../platform/context/request-context.js';
import { Database } from '../platform/database/database.js';
import { DomainError } from '../platform/errors/errors.js';
import { pageArgs, type PageRequest, toPage } from '../platform/pagination.js';

type DeviceInput = RouteInput<
  typeof notificationContract.registerDevice
>['body'];

const CATEGORIES: readonly NotificationCategory[] = [
  'ALERT',
  'WARNING',
  'SUCCESS',
  'INFORMATION',
];
const PUSHED: readonly NotificationCategory[] = ['ALERT', 'WARNING'];

/**
 * M10 for the signed-in user: their notifications (US-070), their devices
 * (US-071) and their preferences (US-073). Everything is scoped to
 * `context.userId` — a notification is only ever its recipient's — except an
 * Admin deregistering a device in their organization.
 */
@Injectable()
export class NotificationCentreService {
  constructor(
    private readonly database: Database,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  async list(
    context: RequestContext,
    query: PageRequest & {
      unread?: 'true' | 'false' | undefined;
      category?: NotificationCategory | undefined;
    },
  ) {
    const tx = this.database.client;
    const rows = await tx.notification.findMany({
      where: {
        userId: context.userId,
        ...(query.unread === 'true' ? { readAt: null } : {}),
        ...(query.category ? { category: query.category } : {}),
      },
      ...pageArgs(query),
      // Newest first: cuid ids sort by creation, so descending id is newest first.
      orderBy: { id: 'desc' },
    });
    return {
      ...toPage(rows, query, toView),
      unreadCount: await this.unread(tx, context),
    };
  }

  async markRead(context: RequestContext, notificationId: string) {
    return this.database.transaction(async (tx) => {
      foundInScope(
        await tx.notification.findFirst({
          where: { id: notificationId, userId: context.userId },
          select: { id: true },
        }),
        'notification',
      );
      await tx.notification.updateMany({
        where: { id: notificationId, readAt: null },
        data: { readAt: new Date() },
      });
      return { unreadCount: await this.unread(tx, context) };
    });
  }

  async markAllRead(context: RequestContext) {
    return this.database.transaction(async (tx) => {
      await tx.notification.updateMany({
        where: { userId: context.userId, readAt: null },
        data: { readAt: new Date() },
      });
      return { unreadCount: 0 };
    });
  }

  pushConfig() {
    return {
      provider: this.config.PUSH_PROVIDER,
      vapidPublicKey:
        this.config.PUSH_PROVIDER === 'WEB_PUSH' ||
        this.config.PUSH_PROVIDER === 'BOTH'
          ? (this.config.VAPID_PUBLIC_KEY ?? null)
          : null,
    };
  }

  async devices(context: RequestContext): Promise<{ data: PushDevice[] }> {
    const rows = await this.database.client.pushSubscription.findMany({
      where: { userId: context.userId },
      orderBy: { lastSeenAt: 'desc' },
    });
    return { data: rows.map(toDevice) };
  }

  /**
   * Registers or refreshes a device. A browser signed in by someone else before
   * keeps its endpoint: the subscription moves to the new user, so the last
   * person signed in on a shared phone is the one it buzzes for — and pushes
   * still queued for the previous user expire, so none of their notifications
   * reach the new holder's lock screen.
   *
   * The server POSTs to a Web Push endpoint, so only known push services are
   * accepted; anything else would let a signed-in user aim the API at any host.
   */
  async register(
    context: RequestContext,
    input: DeviceInput,
  ): Promise<PushDevice> {
    const allowed = this.pushConfig().provider;
    if (
      allowed === 'NONE' ||
      (allowed !== 'BOTH' && allowed !== input.provider)
    ) {
      throw new DomainError(
        'PUSH_PROVIDER_DISABLED',
        `${input.provider} push is not enabled on this deployment`,
      );
    }
    if (input.provider === 'WEB_PUSH' && !isKnownPushEndpoint(input.endpoint)) {
      throw new DomainError(
        'PUSH_ENDPOINT_NOT_ALLOWED',
        'The push endpoint is not a known browser push service',
      );
    }
    return this.database.transaction(async (tx) => {
      const existing = await tx.pushSubscription.findFirst({
        where:
          input.provider === 'WEB_PUSH'
            ? { endpoint: input.endpoint }
            : { fcmToken: input.fcmToken },
        select: { id: true, userId: true },
      });
      if (existing && existing.userId !== context.userId) {
        await tx.notificationOutbox.updateMany({
          where: { pushSubscriptionId: existing.id, status: 'PENDING' },
          data: { status: 'EXPIRED' },
        });
      }
      const now = new Date();
      const common = {
        userId: context.userId,
        deviceLabel: input.deviceLabel ?? null,
        lastSeenAt: now,
        isActive: true,
      };
      const row =
        input.provider === 'WEB_PUSH'
          ? await tx.pushSubscription.upsert({
              where: { endpoint: input.endpoint },
              create: {
                ...common,
                provider: 'WEB_PUSH',
                endpoint: input.endpoint,
                p256dh: input.p256dh,
                auth: input.auth,
              },
              update: { ...common, p256dh: input.p256dh, auth: input.auth },
            })
          : await tx.pushSubscription.upsert({
              where: { fcmToken: input.fcmToken },
              create: { ...common, provider: 'FCM', fcmToken: input.fcmToken },
              update: common,
            });
      return toDevice(row);
    });
  }

  async deregister(
    context: RequestContext,
    subscriptionId: string,
  ): Promise<PushDevice> {
    return this.database.transaction(async (tx) => {
      // M10 operations: deregister a device — self, or Admin and above.
      const admin = context.role === 'ADMIN' || context.role === 'SUPER_ADMIN';
      const where: Prisma.PushSubscriptionWhereInput = admin
        ? {
            id: subscriptionId,
            user: { staffProfile: { organizationId: context.organizationId } },
          }
        : { id: subscriptionId, userId: context.userId };
      foundInScope(
        await tx.pushSubscription.findFirst({ where, select: { id: true } }),
        'subscription',
      );
      const row = await tx.pushSubscription.update({
        where: { id: subscriptionId },
        data: { isActive: false },
      });
      await tx.notificationOutbox.updateMany({
        where: { pushSubscriptionId: subscriptionId, status: 'PENDING' },
        data: { status: 'EXPIRED' },
      });
      return toDevice(row);
    });
  }

  async preferences(context: RequestContext): Promise<NotificationPreferences> {
    const rows = await this.database.client.notificationPreference.findMany({
      where: { userId: context.userId },
    });
    const off = new Set(
      rows.filter((row) => !row.enabled).map((row) => row.category),
    );
    return {
      categories: CATEGORIES.map((category) => ({
        category,
        enabled: category === 'ALERT' || !off.has(category),
        locked: category === 'ALERT',
        pushed: PUSHED.includes(category),
        emailed:
          EMAILED.includes(category) && this.config.EMAIL_PROVIDER === 'SMTP',
      })),
    };
  }

  async updatePreferences(
    context: RequestContext,
    input: {
      categories: { category: NotificationCategory; enabled: boolean }[];
    },
  ): Promise<NotificationPreferences> {
    if (
      input.categories.some((row) => row.category === 'ALERT' && !row.enabled)
    ) {
      throw new DomainError(
        'ALERT_ALWAYS_ON',
        'Alerts cannot be switched off',
        [{ field: 'categories', issue: 'ALERT must stay enabled' }],
      );
    }
    await this.database.transaction(async (tx) => {
      for (const row of input.categories) {
        await tx.notificationPreference.upsert({
          where: {
            userId_category: { userId: context.userId, category: row.category },
          },
          create: {
            userId: context.userId,
            category: row.category,
            enabled: row.enabled,
          },
          update: { enabled: row.enabled },
        });
      }
    });
    return this.preferences(context);
  }

  private unread(tx: Prisma.TransactionClient, context: RequestContext) {
    return tx.notification.count({
      where: { userId: context.userId, readAt: null },
    });
  }
}

function toView(row: {
  id: string;
  category: NotificationCategory;
  eventType: string;
  title: string;
  body: string;
  payload: Prisma.JsonValue;
  readAt: Date | null;
  createdAt: Date;
}): NotificationView {
  const link = row.payload as {
    entityType?: string | null;
    entityId?: string | null;
    url?: string;
  } | null;
  return {
    id: row.id,
    category: row.category,
    eventType: row.eventType as NotificationView['eventType'],
    title: row.title,
    body: row.body,
    link: link?.url
      ? {
          entityType: link.entityType ?? null,
          entityId: link.entityId ?? null,
          url: link.url,
        }
      : null,
    readAt: row.readAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

function toDevice(row: {
  id: string;
  provider: 'WEB_PUSH' | 'FCM';
  deviceLabel: string | null;
  lastSeenAt: Date;
  isActive: boolean;
}): PushDevice {
  return {
    id: row.id,
    provider: row.provider,
    deviceLabel: row.deviceLabel,
    lastSeenAt: row.lastSeenAt.toISOString(),
    isActive: row.isActive,
  };
}
