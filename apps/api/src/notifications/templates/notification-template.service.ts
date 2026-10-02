import { Injectable } from '@nestjs/common';
import type {
  TemplateDetail,
  TemplateLanguage,
  TemplateList,
  TemplatePreview,
  TemplateSummary,
} from '@repo/contracts';
import type { Prisma } from '@repo/db';

import { AuditWriter } from '../../audit/audit.writer.js';
import { EmailOutbox } from '../../email/email-outbox.js';
import type { RequestContext } from '../../platform/context/request-context.js';
import { Database } from '../../platform/database/database.js';
import { DomainError, NotFoundError } from '../../platform/errors/errors.js';
import { NotificationService } from '../notification.service.js';
import {
  CATALOGUE,
  channelLock,
  defaultChannels,
  type TemplateContent,
  type TemplateDefinition,
  templateDefinition,
} from './catalogue.js';
import {
  type Channels,
  contentOf,
  effectiveChannels,
  NotificationTemplates,
  renderMessage,
  sampleValues,
  templateProblems,
} from './notification-templates.js';

type Tx = Prisma.TransactionClient;

const LANGUAGES: readonly TemplateLanguage[] = ['EN', 'TA'];

/**
 * US-074 — the Super Admin's template manager. Every route is Super Admin
 * only (`notificationTemplate.view` / `.manage`), and every change is audited
 * with before and after: the words a business sends its staff are its own
 * voice, and a changed alert is something an owner should be able to trace.
 *
 * Refusals, each with a stable code:
 *
 * - `TEMPLATE_NOT_FOUND` (404) — not a message in the catalogue.
 * - `TEMPLATE_INVALID` (422) — a placeholder the message does not offer, an
 *   unclosed section, or push words on an email-only message; one detail per
 *   field, so the screen can mark it.
 * - `TEMPLATE_UNCHANGED` / `TEMPLATE_NOT_OVERRIDDEN` (422) — nothing to save,
 *   nothing to reset.
 * - `CHANNEL_LOCKED` (422) — switching off an alert's push or email, or a
 *   password reset's email.
 * - `CHANNEL_NOT_AVAILABLE` (422) — push for an email-only message.
 */
@Injectable()
export class NotificationTemplateService {
  constructor(
    private readonly database: Database,
    private readonly audit: AuditWriter,
    private readonly emails: EmailOutbox,
    private readonly notifications: NotificationService,
    private readonly templates: NotificationTemplates,
  ) {}

  async list(context: RequestContext): Promise<TemplateList> {
    const client = this.database.client;
    const [overrides, choices] = await Promise.all([
      client.notificationTemplate.findMany({
        where: { organizationId: context.organizationId },
        select: { key: true, language: true },
      }),
      client.notificationChannel.findMany({
        where: { organizationId: context.organizationId },
        select: { key: true, push: true, email: true },
      }),
    ]);
    const chosen = new Map(choices.map((row) => [row.key, row] as const));
    return {
      templates: CATALOGUE.map((definition) =>
        summary(
          definition,
          chosen.get(definition.key) ?? null,
          LANGUAGES.filter((language) =>
            overrides.some(
              (row) => row.key === definition.key && row.language === language,
            ),
          ),
        ),
      ),
      delivery: {
        push: this.notifications.pushProviders().length > 0,
        email: this.emails.enabled,
      },
    };
  }

  async detail(context: RequestContext, key: string): Promise<TemplateDetail> {
    const definition = known(key);
    const client = this.database.client;
    const [overrides, choice] = await Promise.all([
      client.notificationTemplate.findMany({
        where: { organizationId: context.organizationId, key },
      }),
      client.notificationChannel.findUnique({
        where: {
          organizationId_key: { organizationId: context.organizationId, key },
        },
        select: { push: true, email: true },
      }),
    ]);
    const versions = LANGUAGES.map((language) => {
      const row = overrides.find((override) => override.language === language);
      return {
        language,
        content: row ? contentOf(row) : definition.defaults[language],
        defaultContent: definition.defaults[language],
        isOverridden: row !== undefined,
        updatedAt: row?.updatedAt.toISOString() ?? null,
      };
    });
    return {
      ...summary(
        definition,
        choice,
        versions.filter((v) => v.isOverridden).map((v) => v.language),
      ),
      variables: definition.variables.map((variable) => ({
        name: variable.name,
        description: variable.description,
        sample: variable.sample,
        emailOnly: variable.emailOnly ?? false,
      })),
      versions,
    };
  }

  /**
   * Saves the business's words for one language. Words identical to the
   * default are not stored as an override — they drop it — so "Edited" on the
   * screen always means "differs from Rasi's wording".
   */
  async save(
    context: RequestContext,
    key: string,
    language: TemplateLanguage,
    content: TemplateContent,
  ): Promise<TemplateDetail> {
    const definition = known(key);
    refuseProblems(definition, content);
    const fallback = definition.defaults[language];

    await this.database.transaction(async (tx) => {
      const existing = await this.override(tx, context, key, language);
      const current = existing ? contentOf(existing) : fallback;
      if (sameContent(current, content)) {
        throw new DomainError(
          'TEMPLATE_UNCHANGED',
          'These are already the words in use.',
          [{ field: 'content', issue: 'is the template already in force' }],
        );
      }
      if (sameContent(fallback, content)) {
        // Only reachable with an override in place: back to the default.
        await this.drop(tx, context, existing!, fallback);
        return;
      }
      const row = await tx.notificationTemplate.upsert({
        where: {
          organizationId_key_language: {
            organizationId: context.organizationId,
            key,
            language,
          },
        },
        create: {
          organizationId: context.organizationId,
          key,
          language,
          ...content,
          createdByUserId: context.userId,
          updatedByUserId: context.userId,
        },
        update: { ...content, updatedByUserId: context.userId },
        select: { id: true },
      });
      await this.audit.record(context, {
        action: existing ? 'UPDATE' : 'CREATE',
        entityTable: 'notification_template',
        entityId: row.id,
        before: { template: key, language, ...current },
        after: { template: key, language, ...content },
      });
    });
    return this.detail(context, key);
  }

  /** Back to the built-in words for one language. */
  async reset(
    context: RequestContext,
    key: string,
    language: TemplateLanguage,
  ): Promise<TemplateDetail> {
    const definition = known(key);
    await this.database.transaction(async (tx) => {
      const existing = await this.override(tx, context, key, language);
      if (!existing) {
        throw new DomainError(
          'TEMPLATE_NOT_OVERRIDDEN',
          'This message already uses Rasi’s own words in that language.',
          [{ field: 'language', issue: 'there is nothing to reset' }],
        );
      }
      await this.drop(tx, context, existing, definition.defaults[language]);
    });
    return this.detail(context, key);
  }

  /** Push and email for one message — an alert's stay on. */
  async updateChannels(
    context: RequestContext,
    key: string,
    input: { push?: boolean | undefined; email?: boolean | undefined },
  ): Promise<TemplateDetail> {
    const definition = known(key);
    if (input.push !== undefined && !definition.notice) {
      throw new DomainError(
        'CHANNEL_NOT_AVAILABLE',
        'This message is only sent by email; it has no push.',
        [{ field: 'push', issue: 'is not a channel of this message' }],
      );
    }
    const lock = channelLock(definition);
    if (lock && (input.push === false || input.email === false)) {
      throw new DomainError('CHANNEL_LOCKED', lock, [
        {
          field: input.email === false ? 'email' : 'push',
          issue: 'cannot be switched off',
        },
      ]);
    }

    await this.database.transaction(async (tx) => {
      const where = {
        organizationId_key: { organizationId: context.organizationId, key },
      };
      const existing = await tx.notificationChannel.findUnique({ where });
      const before = effectiveChannels(definition, existing);
      const after: Channels = {
        push: input.push ?? before.push,
        email: input.email ?? before.email,
      };
      if (before.push === after.push && before.email === after.email) return;
      const row = await tx.notificationChannel.upsert({
        where,
        create: {
          organizationId: context.organizationId,
          key,
          ...after,
          createdByUserId: context.userId,
        },
        update: after,
        select: { id: true },
      });
      await this.audit.record(context, {
        action: existing ? 'UPDATE' : 'CREATE',
        entityTable: 'notification_channel',
        entityId: row.id,
        before: { template: key, ...before },
        after: { template: key, ...after },
      });
    });
    return this.detail(context, key);
  }

  /** Unsaved words, rendered with the catalogue's samples. Writes nothing. */
  async preview(
    context: RequestContext,
    key: string,
    language: TemplateLanguage,
    content: TemplateContent,
  ): Promise<TemplatePreview> {
    const definition = known(key);
    refuseProblems(definition, content);
    const organization =
      await this.database.client.organization.findUniqueOrThrow({
        where: { id: context.organizationId },
        select: { name: true },
      });
    const message = renderMessage(
      definition,
      content,
      language,
      sampleValues(definition),
      {
        url: this.emails.link(previewPath(key)),
        organizationName: organization.name,
      },
    );
    return { title: message.title, body: message.body, email: message.email };
  }

  /**
   * The saved words, with sample values, to the caller alone: into their own
   * centre and to their own devices — whatever the message's push choice, so
   * they can see how it looks — and to their inbox when email is configured.
   * Marked "Test" so it is never taken for a real event.
   */
  async sendTest(
    context: RequestContext,
    key: string,
    language: TemplateLanguage,
  ): Promise<{ inApp: boolean; pushDevices: number; emailQueued: boolean }> {
    const definition = known(key);
    return this.database.transaction(async (tx) => {
      const organization = await tx.organization.findUniqueOrThrow({
        where: { id: context.organizationId },
        select: { name: true },
      });
      const template = await this.templates.resolve(
        tx,
        context.organizationId,
        definition,
      );
      const message = renderMessage(
        definition,
        template.content(language),
        language,
        sampleValues(definition),
        {
          url: this.emails.enabled
            ? this.emails.link(previewPath(key))
            : previewPath(key),
          organizationName: organization.name,
        },
      );
      const email = {
        ...message.email,
        subject: `Test · ${message.email.subject}`,
      };

      if (!definition.notice) {
        const emailQueued = await this.emails.queue({
          organizationId: context.organizationId,
          userId: context.userId,
          kind: 'PASSWORD_RESET',
          content: email,
        });
        return { inApp: false, pushDevices: 0, emailQueued };
      }
      const notification = await tx.notification.create({
        data: {
          userId: context.userId,
          category: definition.notice.category,
          eventType: definition.notice.eventType,
          title: `Test · ${message.title ?? ''}`,
          body: message.body ?? '',
          payload: {
            entityType: 'notification_template',
            entityId: null,
            url: previewPath(key),
          },
        },
        select: { id: true },
      });
      const pushDevices = await this.notifications.queuePush(
        tx,
        context.userId,
        notification.id,
      );
      const emailQueued = await this.emails.queue({
        organizationId: context.organizationId,
        userId: context.userId,
        kind: 'NOTIFICATION',
        notificationId: notification.id,
        content: email,
      });
      return { inApp: true, pushDevices, emailQueued };
    });
  }

  private override(
    tx: Tx,
    context: RequestContext,
    key: string,
    language: TemplateLanguage,
  ) {
    return tx.notificationTemplate.findUnique({
      where: {
        organizationId_key_language: {
          organizationId: context.organizationId,
          key,
          language,
        },
      },
    });
  }

  private async drop(
    tx: Tx,
    context: RequestContext,
    existing: Parameters<typeof contentOf>[0] & {
      id: string;
      key: string;
      language: TemplateLanguage;
    },
    fallback: TemplateContent,
  ): Promise<void> {
    await tx.notificationTemplate.delete({ where: { id: existing.id } });
    await this.audit.record(context, {
      action: 'DELETE',
      entityTable: 'notification_template',
      entityId: existing.id,
      before: {
        template: existing.key,
        language: existing.language,
        ...contentOf(existing),
      },
      after: {
        template: existing.key,
        language: existing.language,
        ...fallback,
      },
    });
  }
}

/** Where a test or preview's button points: the message's own editor. */
function previewPath(key: string): string {
  return `/settings/templates/${key}`;
}

function known(key: string): TemplateDefinition {
  const definition = templateDefinition(key);
  if (!definition) {
    throw new NotFoundError('TEMPLATE_NOT_FOUND', 'Message not found');
  }
  return definition;
}

function refuseProblems(
  definition: TemplateDefinition,
  content: TemplateContent,
): void {
  const problems = templateProblems(definition, content);
  if (problems.length > 0) {
    throw new DomainError(
      'TEMPLATE_INVALID',
      'The template has placeholders this message cannot fill.',
      problems,
    );
  }
}

function sameContent(a: TemplateContent, b: TemplateContent): boolean {
  return (
    a.title === b.title &&
    a.body === b.body &&
    a.emailSubject === b.emailSubject &&
    a.emailHeading === b.emailHeading &&
    a.emailBody === b.emailBody &&
    a.emailAction === b.emailAction &&
    a.emailFooter === b.emailFooter
  );
}

function summary(
  definition: TemplateDefinition,
  choice: Channels | null,
  overridden: TemplateLanguage[],
): TemplateSummary {
  const channels = effectiveChannels(definition, choice);
  const standard = defaultChannels(definition);
  const lock = channelLock(definition);
  return {
    key: definition.key,
    label: definition.label,
    description: definition.description,
    group: definition.group,
    category: definition.notice?.category ?? null,
    recipients: definition.recipients,
    channels: {
      inApp: definition.notice !== null,
      push: definition.notice
        ? {
            enabled: channels.push,
            defaultEnabled: standard.push,
            lockedReason: lock,
          }
        : null,
      email: {
        enabled: channels.email,
        defaultEnabled: standard.email,
        lockedReason: lock,
      },
    },
    overridden,
  };
}
