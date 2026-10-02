import { Injectable } from '@nestjs/common';
import type { TemplateLanguage } from '@repo/contracts';
import type { Prisma } from '@repo/db';

import {
  type RenderedEmail,
  templatedEmail,
} from '../../email/email-templates.js';
import {
  channelLock,
  defaultChannels,
  type TemplateContent,
  type TemplateDefinition,
} from './catalogue.js';
import {
  parseTemplate,
  renderTemplate,
  type TemplateValues,
} from './template-engine.js';

type Tx = Prisma.TransactionClient;

/** A message as one recipient reads it. */
export interface RenderedMessage {
  /** `null` for an email-only message. */
  title: string | null;
  body: string | null;
  email: RenderedEmail;
}

export interface Channels {
  push: boolean;
  email: boolean;
}

/** One message's words and channels for one business, ready to render. */
export interface ResolvedTemplate {
  definition: TemplateDefinition;
  channels: Channels;
  content(language: TemplateLanguage): TemplateContent;
}

const PUSH_FIELDS = ['title', 'body'] as const;
const EMAIL_FIELDS = [
  'emailSubject',
  'emailHeading',
  'emailBody',
  'emailAction',
  'emailFooter',
] as const;

/**
 * US-074 — a business's templates over the catalogue's defaults. Read inside
 * the transaction of the event being notified, so a template saved a moment
 * earlier is the one used, and nothing here writes.
 */
@Injectable()
export class NotificationTemplates {
  /** The catalogue alone — for a recipient with no business, and tests. */
  static defaults(definition: TemplateDefinition): ResolvedTemplate {
    return {
      definition,
      channels: effectiveChannels(definition, null),
      content: (language) => definition.defaults[language],
    };
  }

  async resolve(
    tx: Tx,
    organizationId: string,
    definition: TemplateDefinition,
  ): Promise<ResolvedTemplate> {
    const [overrides, choice] = await Promise.all([
      tx.notificationTemplate.findMany({
        where: { organizationId, key: definition.key },
      }),
      tx.notificationChannel.findUnique({
        where: {
          organizationId_key: { organizationId, key: definition.key },
        },
        select: { push: true, email: true },
      }),
    ]);
    const byLanguage = new Map(
      overrides.map((row) => [row.language, contentOf(row)] as const),
    );
    return {
      definition,
      channels: effectiveChannels(definition, choice),
      content: (language) =>
        byLanguage.get(language) ?? definition.defaults[language],
    };
  }
}

/** The stored choice, with an ALERT's channels held on whatever is stored. */
export function effectiveChannels(
  definition: TemplateDefinition,
  choice: Channels | null,
): Channels {
  if (!definition.notice) return { push: false, email: true };
  if (channelLock(definition) !== null) return { push: true, email: true };
  return choice ?? defaultChannels(definition);
}

export function contentOf(row: {
  title: string | null;
  body: string | null;
  emailSubject: string;
  emailHeading: string;
  emailBody: string;
  emailAction: string;
  emailFooter: string;
}): TemplateContent {
  return {
    title: row.title,
    body: row.body,
    emailSubject: row.emailSubject,
    emailHeading: row.emailHeading,
    emailBody: row.emailBody,
    emailAction: row.emailAction,
    emailFooter: row.emailFooter,
  };
}

/**
 * Every problem with a template, by field — for `422 TEMPLATE_INVALID`.
 * In-app text may use the event's own placeholders; the email may also use
 * `{{title}}` and `{{body}}`, the in-app words as rendered.
 */
export function templateProblems(
  definition: TemplateDefinition,
  content: TemplateContent,
): { field: string; issue: string }[] {
  const problems: { field: string; issue: string }[] = [];
  const inApp = new Set(
    definition.variables.filter((v) => !v.emailOnly).map((v) => v.name),
  );
  const email = new Set(definition.variables.map((v) => v.name));

  for (const field of PUSH_FIELDS) {
    const value = content[field];
    if (!definition.notice) {
      if (value !== null) {
        problems.push({ field, issue: 'this message is sent by email only' });
      }
      continue;
    }
    if (value === null) {
      problems.push({ field, issue: 'is required' });
      continue;
    }
    const parsed = parseTemplate(value, inApp);
    if ('problem' in parsed)
      problems.push({ field, issue: parsed.problem.issue });
  }
  for (const field of EMAIL_FIELDS) {
    const parsed = parseTemplate(content[field], email);
    if ('problem' in parsed)
      problems.push({ field, issue: parsed.problem.issue });
  }
  return problems;
}

/**
 * The words one recipient reads. Never throws: it runs inside the transaction
 * of a collection or a handover. A field that renders blank — every word of it
 * inside a section that did not apply — falls back to the default's, so a push
 * never goes out with no title.
 */
export function renderMessage(
  definition: TemplateDefinition,
  content: TemplateContent,
  language: TemplateLanguage,
  values: TemplateValues,
  link: { url: string; organizationName: string },
): RenderedMessage {
  const fallback = definition.defaults[language];
  const base = { ...values, organizationName: link.organizationName };
  const pick = (
    field: keyof TemplateContent,
    scope: TemplateValues,
  ): string => {
    const own = content[field];
    const rendered = own === null ? '' : renderTemplate(own, scope).trim();
    if (rendered !== '') return rendered;
    const standard = fallback[field];
    return standard === null ? '' : renderTemplate(standard, scope).trim();
  };

  const title = definition.notice ? oneLine(pick('title', base)) : null;
  const body = definition.notice ? pick('body', base) : null;
  const scope = { ...base, title: title ?? '', body: body ?? '' };
  return {
    title,
    body,
    email: templatedEmail({
      subject: pick('emailSubject', scope),
      heading: pick('emailHeading', scope),
      body: pick('emailBody', scope),
      action: pick('emailAction', scope),
      footer: pick('emailFooter', scope),
      url: link.url,
    }),
  };
}

/** A notification title is one line, like an email subject. */
function oneLine(value: string): string {
  return value.replace(/[\r\n]+/g, ' ').trim();
}

/** The catalogue's samples, for the preview and "Send a test". */
export function sampleValues(definition: TemplateDefinition): TemplateValues {
  return Object.fromEntries(
    definition.variables
      .filter((variable) => !variable.emailOnly)
      .map((variable) => [variable.name, variable.sample]),
  );
}
