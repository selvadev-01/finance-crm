import { Controller } from '@nestjs/common';
import {
  notificationContract as api,
  type RouteInput,
  type RouteSuccess,
} from '@repo/contracts';

import { CurrentContext, RequirePermission } from '../access/decorators.js';
import type { RequestContext } from '../platform/context/request-context.js';
import {
  ContractInput,
  ContractRoute,
} from '../platform/contract/contract-route.js';
import { NotificationCentreService } from './notification-centre.service.js';

/** M10 for the signed-in user. Every row is the caller's own (M02). */
@Controller()
export class NotificationController {
  constructor(private readonly centre: NotificationCentreService) {}

  @RequirePermission('notification.viewOwn')
  @ContractRoute(api.listNotifications)
  listNotifications(
    @CurrentContext() context: RequestContext,
    @ContractInput() { query }: RouteInput<typeof api.listNotifications>,
  ): Promise<RouteSuccess<typeof api.listNotifications>> {
    return this.centre.list(context, query);
  }

  @RequirePermission('notification.viewOwn')
  @ContractRoute(api.markRead)
  markRead(
    @CurrentContext() context: RequestContext,
    @ContractInput() { params }: RouteInput<typeof api.markRead>,
  ): Promise<RouteSuccess<typeof api.markRead>> {
    return this.centre.markRead(context, params.notificationId);
  }

  @RequirePermission('notification.viewOwn')
  @ContractRoute(api.markAllRead)
  markAllRead(
    @CurrentContext() context: RequestContext,
  ): Promise<RouteSuccess<typeof api.markAllRead>> {
    return this.centre.markAllRead(context);
  }

  @RequirePermission('notification.registerDevice')
  @ContractRoute(api.getPushConfig)
  getPushConfig(): RouteSuccess<typeof api.getPushConfig> {
    return this.centre.pushConfig();
  }

  @RequirePermission('notification.registerDevice')
  @ContractRoute(api.listDevices)
  listDevices(
    @CurrentContext() context: RequestContext,
  ): Promise<RouteSuccess<typeof api.listDevices>> {
    return this.centre.devices(context);
  }

  @RequirePermission('notification.registerDevice')
  @ContractRoute(api.registerDevice)
  registerDevice(
    @CurrentContext() context: RequestContext,
    @ContractInput() { body }: RouteInput<typeof api.registerDevice>,
  ): Promise<RouteSuccess<typeof api.registerDevice>> {
    return this.centre.register(context, body);
  }

  @RequirePermission('notification.registerDevice')
  @ContractRoute(api.deregisterDevice)
  deregisterDevice(
    @CurrentContext() context: RequestContext,
    @ContractInput() { params }: RouteInput<typeof api.deregisterDevice>,
  ): Promise<RouteSuccess<typeof api.deregisterDevice>> {
    return this.centre.deregister(context, params.subscriptionId);
  }

  @RequirePermission('notification.managePreferences')
  @ContractRoute(api.getPreferences)
  getPreferences(
    @CurrentContext() context: RequestContext,
  ): Promise<RouteSuccess<typeof api.getPreferences>> {
    return this.centre.preferences(context);
  }

  @RequirePermission('notification.managePreferences')
  @ContractRoute(api.updatePreferences)
  updatePreferences(
    @CurrentContext() context: RequestContext,
    @ContractInput() { body }: RouteInput<typeof api.updatePreferences>,
  ): Promise<RouteSuccess<typeof api.updatePreferences>> {
    return this.centre.updatePreferences(context, body);
  }
}
