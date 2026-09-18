import { Inject, Injectable } from '@nestjs/common';
import type { NotificationCategory, NotificationEvent } from '@repo/contracts';
import type { Prisma } from '@repo/db';
import { type CalendarDate, toMoney } from '@repo/domain';

import { assignmentInEffectOn } from '../access/scope.js';
import { EmailOutbox } from '../email/email-outbox.js';
import { notificationEmail } from '../email/email-templates.js';
import { APP_CONFIG, type AppConfig } from '../platform/config/config.js';
import { Database } from '../platform/database/database.js';
import { InternalError } from '../platform/errors/errors.js';

type Tx = Prisma.TransactionClient;

export interface Notice {
  recipients: (string | null | undefined)[];
  category: NotificationCategory;
  eventType: NotificationEvent;
  title: string;
  body: string;
  link: { entityType: string | null; entityId: string | null; url: string };
  /** Whoever caused the event is never told about it. */
  actorUserId?: string | null;
}

/** notifications.md#what-is-pushed — the rest is in-app only. */
const PUSHED: readonly NotificationCategory[] = ['ALERT', 'WARNING'];

/**
 * notifications.md#email — only alerts are emailed. Warnings fire on every
 * extra collection and correction request; an inbox would drown in them.
 */
export const EMAILED: readonly NotificationCategory[] = ['ALERT'];

/**
 * M10 — raising a notification. **Called inside the transaction of the event
 * it describes** and refuses otherwise: the in-app notification commits or
 * rolls back with its cause, and so does each push delivery row (one per
 * active device) and, for an alert, the email row — which the dispatch jobs
 * drain later (M14). Push and email can fail; the notification is already in
 * the centre.
 *
 * A category the recipient switched off is skipped — never `ALERT` (US-073).
 */
@Injectable()
export class NotificationService {
  constructor(
    private readonly database: Database,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly emails: EmailOutbox,
  ) {}

  async raise(notice: Notice): Promise<number> {
    if (!this.database.inTransaction) {
      throw new InternalError(
        'NOTIFICATION_OUTSIDE_TRANSACTION',
        `Notification ${notice.eventType} raised outside a transaction`,
      );
    }
    const tx = this.database.client;
    const recipients = [
      ...new Set(
        notice.recipients.filter(
          (id): id is string =>
            typeof id === 'string' && id !== notice.actorUserId,
        ),
      ),
    ];
    if (recipients.length === 0) return 0;

    const muted =
      notice.category === 'ALERT'
        ? new Set<string>()
        : new Set(
            (
              await tx.notificationPreference.findMany({
                where: {
                  userId: { in: recipients },
                  category: notice.category,
                  enabled: false,
                },
                select: { userId: true },
              })
            ).map((row) => row.userId),
          );
    const providers = this.pushProviders();
    let raised = 0;

    for (const userId of recipients) {
      if (muted.has(userId)) continue;
      const notification = await tx.notification.create({
        data: {
          userId,
          category: notice.category,
          eventType: notice.eventType,
          title: notice.title,
          body: notice.body,
          payload: notice.link,
        },
        select: { id: true },
      });
      raised += 1;
      if (EMAILED.includes(notice.category) && this.emails.enabled) {
        await this.queueEmail(tx, userId, notification.id, notice);
      }
      if (!PUSHED.includes(notice.category) || providers.length === 0) continue;
      const devices = await tx.pushSubscription.findMany({
        where: { userId, isActive: true, provider: { in: providers } },
        select: { id: true },
      });
      if (devices.length > 0) {
        await tx.notificationOutbox.createMany({
          data: devices.map((device) => ({
            notificationId: notification.id,
            pushSubscriptionId: device.id,
            nextAttemptAt: new Date(),
          })),
        });
      }
    }
    return raised;
  }

  /** The email copy of a notification, for a recipient who is staff. */
  private async queueEmail(
    tx: Tx,
    userId: string,
    notificationId: string,
    notice: Notice,
  ): Promise<void> {
    const staff = await tx.staffProfile.findUnique({
      where: { userId },
      select: { organization: { select: { id: true, name: true } } },
    });
    if (!staff) return;
    await this.emails.queue({
      organizationId: staff.organization.id,
      userId,
      kind: 'NOTIFICATION',
      notificationId,
      content: notificationEmail({
        title: notice.title,
        body: notice.body,
        url: this.emails.link(notice.link.url),
        organizationName: staff.organization.name,
      }),
    });
  }

  /** Which stored subscriptions are pushed to under the current configuration. */
  pushProviders(): ('WEB_PUSH' | 'FCM')[] {
    switch (this.config.PUSH_PROVIDER) {
      case 'WEB_PUSH':
        return ['WEB_PUSH'];
      case 'FCM':
        return ['FCM'];
      case 'BOTH':
        return ['WEB_PUSH', 'FCM'];
      case 'NONE':
        return [];
    }
  }
}

/**
 * Who hears about what (M10 scoping, decided 2026-09-14): a line's events go
 * to the Senior assigned to it on the day the event fires; cash and integrity
 * events also go to the organization's Admins and Super Admins.
 */
@Injectable()
export class Recipients {
  constructor(private readonly database: Database) {}

  async seniorOf(
    tx: Tx,
    lineId: string,
    on: CalendarDate,
  ): Promise<string | null> {
    const row = await tx.lineAssignment.findFirst({
      where: { lineId, assignmentRole: 'SENIOR', ...assignmentInEffectOn(on) },
      select: { staffProfile: { select: { userId: true } } },
    });
    return row?.staffProfile.userId ?? null;
  }

  async admins(tx: Tx, organizationId: string): Promise<string[]> {
    const rows = await tx.staffProfile.findMany({
      where: {
        organizationId,
        role: { in: ['ADMIN', 'SUPER_ADMIN'] },
        status: 'ACTIVE',
        deletedAt: null,
      },
      select: { userId: true },
    });
    return rows.map((row) => row.userId);
  }

  /**
   * Seniors and Juniors assigned on `on` to the organization's active lines —
   * every line, or one sector's.
   */
  async lineStaff(
    tx: Tx,
    organizationId: string,
    sectorId: string | null,
    on: CalendarDate,
  ): Promise<{ seniors: string[]; juniors: string[] }> {
    const rows = await tx.lineAssignment.findMany({
      where: {
        ...assignmentInEffectOn(on),
        line: {
          organizationId,
          isActive: true,
          ...(sectorId ? { sectorId } : {}),
        },
        staffProfile: { status: 'ACTIVE', deletedAt: null },
      },
      select: {
        assignmentRole: true,
        staffProfile: { select: { userId: true } },
      },
    });
    const of = (role: 'SENIOR' | 'JUNIOR') => [
      ...new Set(
        rows
          .filter((row) => row.assignmentRole === role)
          .map((row) => row.staffProfile.userId),
      ),
    ];
    return { seniors: of('SENIOR'), juniors: of('JUNIOR') };
  }

  async nameOf(tx: Tx, userId: string): Promise<string> {
    const user = await tx.user.findUnique({
      where: { id: userId },
      select: { name: true },
    });
    return user?.name ?? 'A staff member';
  }
}

/** `₹1,23,456.00` for notification text — Indian grouping, never a float. */
export function rupees(amount: { toString(): string }): string {
  const fixed = toMoney(amount.toString()).toFixed(2);
  const negative = fixed.startsWith('-');
  const [whole = '0', paise = '00'] = fixed.replace('-', '').split('.');
  const lastThree = whole.slice(-3);
  const rest = whole.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ',');
  return `${negative ? '−' : ''}₹${rest ? `${rest},` : ''}${lastThree}.${paise}`;
}
