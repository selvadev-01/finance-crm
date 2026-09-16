import { Inject, Injectable } from '@nestjs/common';
import {
  type EmailProvider,
  outcome,
  SmtpEmailProvider,
} from '@repo/notifications';
import { PinoLogger } from 'nestjs-pino';

import type { AppConfig } from '../platform/config/config.js';
import type { SystemContext } from '../platform/context/system-context.js';
import { Database } from '../platform/database/database.js';

/** Rows claimed per run; the job runs every minute. */
const BATCH = 50;
/** A claimed row is invisible to other runs for this long, then retried. */
const LEASE_MS = 5 * 60_000;

/** Injection token for the email provider, so tests supply a fake transport. */
export const EMAIL_PROVIDER = Symbol('EMAIL_PROVIDER');

/** `null` unless `EMAIL_PROVIDER=SMTP` with a host and a sender. */
export function emailProviderFromConfig(
  config: AppConfig,
): EmailProvider | null {
  if (
    config.EMAIL_PROVIDER !== 'SMTP' ||
    !config.SMTP_HOST ||
    !config.EMAIL_FROM
  ) {
    return null;
  }
  return new SmtpEmailProvider({
    host: config.SMTP_HOST,
    port: config.SMTP_PORT,
    secure: config.SMTP_SECURE,
    ...(config.SMTP_USER && config.SMTP_PASS
      ? { auth: { user: config.SMTP_USER, pass: config.SMTP_PASS } }
      : {}),
    from: config.EMAIL_FROM,
  });
}

export interface EmailDispatchReport {
  sent: number;
  retrying: number;
  failed: number;
  expired: number;
}

/**
 * Email delivery, run by the `dispatch-emails` job (M14) for one organization.
 * The same three steps as push (`PushDispatchService`):
 *
 * 1. **Claim** due `PENDING` rows with `FOR UPDATE SKIP LOCKED`, count the
 *    attempt and move `nextAttemptAt` out by a lease, so two workers never send
 *    the same email and a worker that dies mid-send leaves it to be retried.
 * 2. **Send**, to the recipient's address as it is now. A recipient who is no
 *    longer an active staff member gets nothing: the row is `EXPIRED`.
 * 3. **Record** `SENT`; `PENDING` with the next backoff (1 min, 5 min, 30 min,
 *    2 h); or `FAILED` with the server's reply, once it is permanent or the
 *    attempts run out.
 *
 * A failed email never undoes anything: the notification is still in the app.
 */
@Injectable()
export class EmailDispatchService {
  constructor(
    private readonly database: Database,
    @Inject(EMAIL_PROVIDER) private readonly provider: EmailProvider | null,
    private readonly logger: PinoLogger,
  ) {}

  async dispatch(
    system: SystemContext,
    now: Date = new Date(),
  ): Promise<EmailDispatchReport> {
    const report: EmailDispatchReport = {
      sent: 0,
      retrying: 0,
      failed: 0,
      expired: 0,
    };
    // Switched off after rows were queued: leave them for when it is back.
    if (this.provider === null) return report;

    const tx = this.database.client;
    const lease = new Date(now.getTime() + LEASE_MS);
    const claimed = await tx.$queryRaw<{ id: string; attempts: number }[]>`
      UPDATE email_outbox o
      SET attempts = o.attempts + 1, "nextAttemptAt" = ${lease}, "updatedAt" = now()
      WHERE o.id IN (
        SELECT o2.id
        FROM email_outbox o2
        WHERE o2.status = 'PENDING'
          AND o2."organizationId" = ${system.organizationId}
          AND (o2."nextAttemptAt" IS NULL OR o2."nextAttemptAt" <= ${now})
        ORDER BY o2."nextAttemptAt" NULLS FIRST
        LIMIT ${BATCH}
        FOR UPDATE OF o2 SKIP LOCKED
      )
      RETURNING o.id, o.attempts`;

    for (const row of claimed) {
      const email = await tx.emailOutbox.findUniqueOrThrow({
        where: { id: row.id },
        select: {
          subject: true,
          textBody: true,
          htmlBody: true,
          user: {
            select: {
              email: true,
              staffProfile: { select: { status: true, deletedAt: true } },
            },
          },
        },
      });
      const staff = email.user.staffProfile;
      if (!staff || staff.status !== 'ACTIVE' || staff.deletedAt !== null) {
        report.expired += 1;
        await tx.emailOutbox.update({
          where: { id: row.id },
          data: { status: 'EXPIRED', nextAttemptAt: null },
        });
        continue;
      }

      const result = await this.provider.send({
        to: email.user.email,
        subject: email.subject,
        text: email.textBody,
        ...(email.htmlBody ? { html: email.htmlBody } : {}),
      });
      const next = outcome(result, row.attempts, now);

      if (next.status === 'SENT') {
        report.sent += 1;
        await tx.emailOutbox.update({
          where: { id: row.id },
          data: {
            status: 'SENT',
            sentAt: now,
            lastError: null,
            nextAttemptAt: null,
          },
        });
      } else if (next.status === 'PENDING') {
        report.retrying += 1;
        await tx.emailOutbox.update({
          where: { id: row.id },
          data: {
            nextAttemptAt: next.nextAttemptAt,
            lastError: next.lastError,
          },
        });
      } else {
        report.failed += 1;
        await tx.emailOutbox.update({
          where: { id: row.id },
          data: {
            status: 'FAILED',
            lastError: next.lastError,
            nextAttemptAt: null,
          },
        });
        // Ids only: the address and the server's reply stay in the row.
        this.logger.warn(
          { id: row.id, count: row.attempts },
          'Email delivery failed',
        );
      }
    }
    return report;
  }
}
