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

/**
 * M10 Notifications. Global, like M13's audit writer: events are raised from
 * collections, corrections, assignments, day close, handovers and
 * reconciliation, each inside its own transaction, through
 * `NotificationService`.
 */
@Global()
@Module({
  controllers: [NotificationController],
  providers: [
    NotificationService,
    Recipients,
    EventNotices,
    NotificationCentreService,
    PushDispatchService,
    {
      provide: PUSH_PROVIDERS,
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig) => pushProvidersFromConfig(config),
    },
  ],
  exports: [NotificationService, Recipients, EventNotices, PushDispatchService],
})
export class NotificationsModule {}
