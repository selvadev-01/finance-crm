import { Global, Module } from '@nestjs/common';

import { APP_CONFIG, type AppConfig } from '../platform/config/config.js';
import {
  EMAIL_PROVIDER,
  EmailDispatchService,
  emailProviderFromConfig,
} from './email-dispatch.service.js';
import { EmailOutbox } from './email-outbox.js';

/**
 * Email over SMTP (notifications.md#email). Global, like the audit writer and
 * notifications: any module queues an email inside its own transaction through
 * `EmailOutbox`, and `dispatch-emails` sends it.
 */
@Global()
@Module({
  providers: [
    EmailOutbox,
    EmailDispatchService,
    {
      provide: EMAIL_PROVIDER,
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig) => emailProviderFromConfig(config),
    },
  ],
  exports: [EmailOutbox, EmailDispatchService],
})
export class EmailModule {}
