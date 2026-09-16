import { EmailOutbox } from '../../src/email/email-outbox.js';
import { EventNotices } from '../../src/notifications/event-notices.js';
import {
  NotificationService,
  Recipients,
} from '../../src/notifications/notification.service.js';
import type { AppConfig } from '../../src/platform/config/config.js';
import type { Database } from '../../src/platform/database/database.js';

/**
 * The notification services for a Tier 1 world, wired over the same rolled-back
 * transaction. `pushProvider` decides whether push delivery rows are written,
 * and `emailProvider` whether alert emails are queued.
 */
export function testNotifications(
  database: Database,
  pushProvider: AppConfig['PUSH_PROVIDER'] = 'NONE',
  emailProvider: AppConfig['EMAIL_PROVIDER'] = 'NONE',
) {
  const config = {
    PUSH_PROVIDER: pushProvider,
    EMAIL_PROVIDER: emailProvider,
    WEB_ORIGIN: 'https://rasi.example',
  } as AppConfig;
  const emails = new EmailOutbox(database, config);
  const notifications = new NotificationService(database, config, emails);
  const recipients = new Recipients(database);
  return {
    config,
    emails,
    notifications,
    recipients,
    notices: new EventNotices(database, notifications, recipients),
  };
}
