import { Inject, Injectable } from '@nestjs/common';
import type { TemplateLanguage } from '@repo/contracts';
import type { Prisma } from '@repo/db';
import { type CalendarDate, toMoney } from '@repo/domain';

import { assignmentInEffectOn } from '../access/scope.js';
import { EmailOutbox } from '../email/email-outbox.js';
import { APP_CONFIG, type AppConfig } from '../platform/config/config.js';
import { Database } from '../platform/database/database.js';
import { InternalError } from '../platform/errors/errors.js';
import { noticeDefinition, type TemplateKey } from './templates/catalogue.js';
import {
  NotificationTemplates,
  type RenderedMessage,
  renderMessage,
  type ResolvedTemplate,
} from './templates/notification-templates.js';
import type { TemplateValues } from './templates/template-engine.js';

type Tx = Prisma.TransactionClient;

export interface Notice {
  recipients: (string | null | undefined)[];
  /**
   * Which message (US-074). Its category and event type come from the
   * catalogue, and its words from the business's template in each
   * recipient's language, or the default.
   */
  template: TemplateKey;
  /** The placeholders, already formatted — money through `rupees`. */
  values: TemplateValues;
  link: { entityType: string | null; entityId: string | null; url: string };
  /** Whoever caused the event is never told about it. */
  actorUserId?: string | null;
}

interface Recipient {
  userId: string;
  language: TemplateLanguage;
  organization: { id: string; name: string } | null;
}

/**
 * M10 — raising a notification. **Called inside the transaction of the event
 * it describes** and refuses otherwise: the in-app notification commits or
 * rolls back with its cause, and so does each push delivery row (one per
 * active device) and the email row — which the dispatch jobs drain later
 * (M14). Push and email can fail; the notification is already in the centre.
 *
 * Each recipient's copy is rendered from the business's template in their own
 * language (US-074) and stored as text, so a later edit to the template never
 * rewrites it. Whether it is pushed and emailed is the business's choice per
 * message, defaulting from the category — ALERT and WARNING pushed, ALERT
 * emailed — and an ALERT is always both.
 *
 * A category the recipient switched off is skipped — never `ALERT` (US-073).
 */
@Injectable()
export class NotificationService {
  constructor(
    private readonly database: Database,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly emails: EmailOutbox,
    private readonly templates: NotificationTemplates,
  ) {}

  async raise(notice: Notice): Promise<number> {
    if (!this.database.inTransaction) {
      throw new InternalError(
        'NOTIFICATION_OUTSIDE_TRANSACTION',
        `Notification ${notice.template} raised outside a transaction`,
      );
    }
    const tx = this.database.client;
    const definition = noticeDefinition(notice.template);
    const { category, eventType } = definition.notice;
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
      category === 'ALERT'
        ? new Set<string>()
        : new Set(
            (
              await tx.notificationPreference.findMany({
                where: {
                  userId: { in: recipients },
                  category,
                  enabled: false,
                },
                select: { userId: true },
              })
            ).map((row) => row.userId),
          );
    const people = await this.recipientsOf(tx, recipients);
    const providers = this.pushProviders();
    // One resolution per business and one rendering per language: a holiday
    // told to forty staff reads its template once.
    const resolved = new Map<string, Promise<ResolvedTemplate>>();
    const rendered = new Map<string, Promise<RenderedMessage>>();
    const messageFor = (person: Recipient) => {
      const organization = person.organization;
      const cacheKey = `${organization?.id ?? ''}:${person.language}`;
      let message = rendered.get(cacheKey);
      if (!message) {
        message = this.templateOf(
          tx,
          organization?.id ?? null,
          definition,
          resolved,
        ).then((template) =>
          renderMessage(
            definition,
            template.content(person.language),
            person.language,
            notice.values,
            {
              // The email copy's button; with no email there is no copy to point.
              url: this.emails.enabled
                ? this.emails.link(notice.link.url)
                : notice.link.url,
              organizationName: organization?.name ?? 'Rasi',
            },
          ),
        );
        rendered.set(cacheKey, message);
      }
      return message;
    };
    let raised = 0;

    for (const person of people) {
      if (muted.has(person.userId)) continue;
      const message = await messageFor(person);
      const channels = (
        await this.templateOf(
          tx,
          person.organization?.id ?? null,
          definition,
          resolved,
        )
      ).channels;
      const notification = await tx.notification.create({
        data: {
          userId: person.userId,
          category,
          eventType,
          title: message.title ?? '',
          body: message.body ?? '',
          payload: notice.link,
        },
        select: { id: true },
      });
      raised += 1;
      if (channels.email && this.emails.enabled && person.organization) {
        await this.emails.queue({
          organizationId: person.organization.id,
          userId: person.userId,
          kind: 'NOTIFICATION',
          notificationId: notification.id,
          content: message.email,
        });
      }
      if (channels.push) {
        await this.queuePush(tx, person.userId, notification.id, providers);
      }
    }
    return raised;
  }

  /**
   * One delivery row per active device of a provider this deployment pushes
   * through. Returns how many were queued.
   */
  async queuePush(
    tx: Tx,
    userId: string,
    notificationId: string,
    providers = this.pushProviders(),
  ): Promise<number> {
    if (providers.length === 0) return 0;
    const devices = await tx.pushSubscription.findMany({
      where: { userId, isActive: true, provider: { in: providers } },
      select: { id: true },
    });
    if (devices.length > 0) {
      await tx.notificationOutbox.createMany({
        data: devices.map((device) => ({
          notificationId,
          pushSubscriptionId: device.id,
          nextAttemptAt: new Date(),
        })),
      });
    }
    return devices.length;
  }

  /**
   * Each recipient's language and business, in the order given. A user with no
   * staff profile — none today — reads the default English words and is not
   * emailed, as before templates.
   */
  private async recipientsOf(tx: Tx, userIds: string[]): Promise<Recipient[]> {
    const staff = await tx.staffProfile.findMany({
      where: { userId: { in: userIds } },
      select: {
        userId: true,
        language: true,
        organization: { select: { id: true, name: true } },
      },
    });
    const byUser = new Map(staff.map((row) => [row.userId, row] as const));
    return userIds.map(
      (userId) =>
        byUser.get(userId) ?? { userId, language: 'EN', organization: null },
    );
  }

  private templateOf(
    tx: Tx,
    organizationId: string | null,
    definition: ResolvedTemplate['definition'],
    cache: Map<string, Promise<ResolvedTemplate>>,
  ): Promise<ResolvedTemplate> {
    const key = organizationId ?? '';
    let template = cache.get(key);
    if (!template) {
      template =
        organizationId === null
          ? Promise.resolve(NotificationTemplates.defaults(definition))
          : this.templates.resolve(tx, organizationId, definition);
      cache.set(key, template);
    }
    return template;
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
