import { Global, Module } from '@nestjs/common';

import { APP_CONFIG, type AppConfig } from '../platform/config/config.js';
import { EventNotices } from './event-notices.js';
import { NotificationCentreService } from './notification-centre.service.js';
import { NotificationController } from './notification.controller.js';
import { NotificationService, Recipients } from './notification.service.js';
import {
  PUSH_PROVIDERS,
  PushDispatchService,
  pushProvidersFromConfig,
} from './push-dispatch.service.js';
import { StaleSubscriptionService } from './stale-subscriptions.service.js';
import { NotificationTemplateController } from './templates/notification-template.controller.js';
import { NotificationTemplateService } from './templates/notification-template.service.js';
import { NotificationTemplates } from './templates/notification-templates.js';

/**
 * M10 Notifications. Global, like M13's audit writer: events are raised from
 * collections, corrections, assignments, day close, handovers and
 * reconciliation, each inside its own transaction, through
 * `NotificationService`. Their words come from the business's templates
 * (US-074), managed through `NotificationTemplateController`.
 */
@Global()
@Module({
  controllers: [NotificationController, NotificationTemplateController],
  providers: [
    NotificationService,
    NotificationTemplates,
    NotificationTemplateService,
    Recipients,
    EventNotices,
    NotificationCentreService,
    PushDispatchService,
    StaleSubscriptionService,
    {
      provide: PUSH_PROVIDERS,
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig) => pushProvidersFromConfig(config),
    },
  ],
  exports: [
    NotificationService,
    Recipients,
    EventNotices,
    PushDispatchService,
    StaleSubscriptionService,
  ],
})
export class NotificationsModule {}
