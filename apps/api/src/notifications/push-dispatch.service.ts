import { Inject, Injectable } from '@nestjs/common';
import {
  deliver,
  FcmProvider,
  isKnownPushEndpoint,
  outcome,
  type PushProvider,
  type PushTarget,
  WebPushProvider,
} from '@repo/notifications';
import { PinoLogger } from 'nestjs-pino';

import type { AppConfig } from '../platform/config/config.js';
import type { SystemContext } from '../platform/context/system-context.js';
import { Database } from '../platform/database/database.js';

/** Rows claimed per run; the job runs every minute. */
const BATCH = 100;
/** A claimed row is invisible to other runs for this long, then retried. */
const LEASE_MS = 5 * 60_000;

/** Injection token for the push providers, so tests supply fake transports. */
export const PUSH_PROVIDERS = Symbol('PUSH_PROVIDERS');

export function pushProvidersFromConfig(config: AppConfig): PushProvider[] {
  const providers: PushProvider[] = [];
  const web =
    config.PUSH_PROVIDER === 'WEB_PUSH' || config.PUSH_PROVIDER === 'BOTH';
  const fcm = config.PUSH_PROVIDER === 'FCM' || config.PUSH_PROVIDER === 'BOTH';
  if (
    web &&
    config.VAPID_PUBLIC_KEY &&
    config.VAPID_PRIVATE_KEY &&
    config.VAPID_SUBJECT
  ) {
    providers.push(
      new WebPushProvider({
        subject: config.VAPID_SUBJECT,
        publicKey: config.VAPID_PUBLIC_KEY,
        privateKey: config.VAPID_PRIVATE_KEY,
      }),
    );
  }
  if (
    fcm &&
    config.FCM_PROJECT_ID &&
    config.FCM_CLIENT_EMAIL &&
    config.FCM_PRIVATE_KEY
  ) {
    providers.push(
      new FcmProvider({
        projectId: config.FCM_PROJECT_ID,
        clientEmail: config.FCM_CLIENT_EMAIL,
        privateKey: config.FCM_PRIVATE_KEY,
      }),
    );
  }
  return providers;
}

/**
 * M10 push delivery, run by the `dispatch-notifications` job (M14). For one
 * organization:
 *
 * 1. **Claim** due `PENDING` outbox rows with `FOR UPDATE SKIP LOCKED`, count
 *    the attempt and push `nextAttemptAt` out by a lease — so two workers never
 *    send the same row, and a worker that dies mid-send leaves the row to be
 *    retried when the lease ends.
 * 2. **Send** each through the provider its subscription was created with.
 * 3. **Record** the outcome: `SENT`; `PENDING` with the next backoff (1 min,
 *    5 min, 30 min, 2 h); or `FAILED` — a `gone` subscription, or one whose
 *    retry budget ran out, is deactivated and its other pending rows expire.
 *
 * The notification itself is untouched either way: push failure never means
 * the user was not notified (US-071).
 */
@Injectable()
export class PushDispatchService {
  constructor(
    private readonly database: Database,
    @Inject(PUSH_PROVIDERS) private readonly providers: PushProvider[],
    private readonly logger: PinoLogger,
  ) {}

  async dispatch(system: SystemContext, now: Date = new Date()) {
    const tx = this.database.client;
    const lease = new Date(now.getTime() + LEASE_MS);
    const claimed = await tx.$queryRaw<{ id: string; attempts: number }[]>`
      UPDATE notification_outbox o
      SET attempts = o.attempts + 1, "nextAttemptAt" = ${lease}, "updatedAt" = now()
      WHERE o.id IN (
        SELECT o2.id
        FROM notification_outbox o2
        JOIN notification n ON n.id = o2."notificationId"
        JOIN staff_profile s ON s."userId" = n."userId"
        WHERE o2.status = 'PENDING'
          AND (o2."nextAttemptAt" IS NULL OR o2."nextAttemptAt" <= ${now})
          AND s."organizationId" = ${system.organizationId}
        ORDER BY o2."nextAttemptAt" NULLS FIRST
        LIMIT ${BATCH}
        FOR UPDATE OF o2 SKIP LOCKED
      )
      RETURNING o.id, o.attempts`;

    const report = { sent: 0, retrying: 0, failed: 0, deactivated: 0 };
    for (const row of claimed) {
      const item = await tx.notificationOutbox.findUniqueOrThrow({
        where: { id: row.id },
        include: { notification: true, pushSubscription: true },
      });
      const subscription = item.pushSubscription;
      if (!subscription.isActive) {
        await tx.notificationOutbox.update({
          where: { id: row.id },
          data: { status: 'EXPIRED' },
        });
        continue;
      }
      // Registration refuses unknown hosts; never POST to one that got in some other way.
      if (
        subscription.provider === 'WEB_PUSH' &&
        !isKnownPushEndpoint(subscription.endpoint ?? '')
      ) {
        report.failed += 1;
        report.deactivated += 1;
        await this.database.transaction(async (write) => {
          await write.notificationOutbox.update({
            where: { id: row.id },
            data: {
              status: 'FAILED',
              lastError: 'endpoint is not a known push service',
              nextAttemptAt: null,
            },
          });
          await write.pushSubscription.update({
            where: { id: subscription.id },
            data: { isActive: false },
          });
          await write.notificationOutbox.updateMany({
            where: { pushSubscriptionId: subscription.id, status: 'PENDING' },
            data: { status: 'EXPIRED' },
          });
        });
        continue;
      }
      const target: PushTarget =
        subscription.provider === 'WEB_PUSH'
          ? {
              provider: 'WEB_PUSH',
              endpoint: subscription.endpoint!,
              p256dh: subscription.p256dh!,
              auth: subscription.auth!,
            }
          : { provider: 'FCM', fcmToken: subscription.fcmToken! };
      const link = item.notification.payload as {
        entityType?: string | null;
        entityId?: string | null;
        url?: string;
      } | null;
      const result = await deliver(this.providers, target, {
        title: item.notification.title,
        body: item.notification.body,
        data: {
          notificationId: item.notification.id,
          entityType: link?.entityType ?? null,
          entityId: link?.entityId ?? null,
          url: link?.url ?? '/',
        },
      });
      const next = outcome(result, row.attempts, now);

      await this.database.transaction(async (write) => {
        if (next.status === 'SENT') {
          report.sent += 1;
          await write.notificationOutbox.update({
            where: { id: row.id },
            data: {
              status: 'SENT',
              sentAt: now,
              lastError: null,
              nextAttemptAt: null,
            },
          });
          await write.pushSubscription.update({
            where: { id: subscription.id },
            data: { lastSeenAt: now },
          });
          return;
        }
        if (next.status === 'PENDING') {
          report.retrying += 1;
          await write.notificationOutbox.update({
            where: { id: row.id },
            data: {
              nextAttemptAt: next.nextAttemptAt,
              lastError: next.lastError,
            },
          });
          return;
        }
        report.failed += 1;
        await write.notificationOutbox.update({
          where: { id: row.id },
          data: {
            status: 'FAILED',
            lastError: next.lastError,
            nextAttemptAt: null,
          },
        });
        if (next.deactivate) {
          report.deactivated += 1;
          await write.pushSubscription.update({
            where: { id: subscription.id },
            data: { isActive: false },
          });
          await write.notificationOutbox.updateMany({
            where: { pushSubscriptionId: subscription.id, status: 'PENDING' },
            data: { status: 'EXPIRED' },
          });
        }
      });
      if (next.status === 'FAILED') {
        this.logger.warn(
          {
            outboxId: row.id,
            subscriptionId: subscription.id,
            runId: system.runId,
          },
          'Push delivery failed',
        );
      }
    }
    return report;
  }
}
