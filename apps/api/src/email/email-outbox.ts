import { Inject, Injectable } from '@nestjs/common';
import type { EmailKind } from '@repo/db';

import { APP_CONFIG, type AppConfig } from '../platform/config/config.js';
import { Database } from '../platform/database/database.js';
import { InternalError } from '../platform/errors/errors.js';
import type { RenderedEmail } from './email-templates.js';

export interface QueuedEmail {
  organizationId: string;
  /** The recipient. The address is read when the email is sent. */
  userId: string;
  kind: EmailKind;
  /** Required exactly when `kind` is `NOTIFICATION`. */
  notificationId?: string;
  content: RenderedEmail;
}

/**
 * Queues email (notifications.md#email). **Called inside the transaction of
 * the event the email describes**, and refuses otherwise — the same rule as
 * notifications and audit entries (non-negotiable 2): the email row commits or
 * rolls back with its cause, and `dispatch-emails` sends it afterwards. A
 * slow or broken mail server never holds up, or fails, the request.
 *
 * With `EMAIL_PROVIDER=NONE` nothing is queued.
 */
@Injectable()
export class EmailOutbox {
  constructor(
    private readonly database: Database,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  get enabled(): boolean {
    return this.config.EMAIL_PROVIDER === 'SMTP';
  }

  /** An absolute link into the web app, for an email body. */
  link(path: string): string {
    return new URL(path, this.config.WEB_ORIGIN).toString();
  }

  /** `true` when a row was written. */
  async queue(email: QueuedEmail): Promise<boolean> {
    if (!this.database.inTransaction) {
      throw new InternalError(
        'EMAIL_OUTSIDE_TRANSACTION',
        `Email ${email.kind} queued outside a transaction`,
      );
    }
    if (!this.enabled) return false;
    await this.database.client.emailOutbox.create({
      data: {
        organizationId: email.organizationId,
        userId: email.userId,
        kind: email.kind,
        notificationId: email.notificationId ?? null,
        subject: email.content.subject,
        textBody: email.content.text,
        htmlBody: email.content.html,
        nextAttemptAt: new Date(),
      },
    });
    return true;
  }
}
