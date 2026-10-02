import { Controller } from '@nestjs/common';
import {
  notificationTemplateContract as api,
  type RouteInput,
  type RouteSuccess,
} from '@repo/contracts';

import { CurrentContext, RequirePermission } from '../../access/decorators.js';
import type { RequestContext } from '../../platform/context/request-context.js';
import {
  ContractInput,
  ContractRoute,
} from '../../platform/contract/contract-route.js';
import { NotificationTemplateService } from './notification-template.service.js';

/**
 * US-074 notification templates. Super Admin only, like the business settings
 * (rbac-matrix.md, Notifications): the words and channels of every message
 * are how the business speaks to its staff.
 */
@Controller()
export class NotificationTemplateController {
  constructor(private readonly templates: NotificationTemplateService) {}

  @RequirePermission('notificationTemplate.view')
  @ContractRoute(api.listTemplates)
  listTemplates(
    @CurrentContext() context: RequestContext,
  ): Promise<RouteSuccess<typeof api.listTemplates>> {
    return this.templates.list(context);
  }

  @RequirePermission('notificationTemplate.view')
  @ContractRoute(api.getTemplate)
  getTemplate(
    @CurrentContext() context: RequestContext,
    @ContractInput() { params }: RouteInput<typeof api.getTemplate>,
  ): Promise<RouteSuccess<typeof api.getTemplate>> {
    return this.templates.detail(context, params.key);
  }

  @RequirePermission('notificationTemplate.manage')
  @ContractRoute(api.saveTemplate)
  saveTemplate(
    @CurrentContext() context: RequestContext,
    @ContractInput() { params, body }: RouteInput<typeof api.saveTemplate>,
  ): Promise<RouteSuccess<typeof api.saveTemplate>> {
    return this.templates.save(context, params.key, params.language, body);
  }

  @RequirePermission('notificationTemplate.manage')
  @ContractRoute(api.resetTemplate)
  resetTemplate(
    @CurrentContext() context: RequestContext,
    @ContractInput() { params }: RouteInput<typeof api.resetTemplate>,
  ): Promise<RouteSuccess<typeof api.resetTemplate>> {
    return this.templates.reset(context, params.key, params.language);
  }

  @RequirePermission('notificationTemplate.manage')
  @ContractRoute(api.updateChannels)
  updateChannels(
    @CurrentContext() context: RequestContext,
    @ContractInput() { params, body }: RouteInput<typeof api.updateChannels>,
  ): Promise<RouteSuccess<typeof api.updateChannels>> {
    return this.templates.updateChannels(context, params.key, body);
  }

  @RequirePermission('notificationTemplate.view')
  @ContractRoute(api.previewTemplate)
  previewTemplate(
    @CurrentContext() context: RequestContext,
    @ContractInput() { params, body }: RouteInput<typeof api.previewTemplate>,
  ): Promise<RouteSuccess<typeof api.previewTemplate>> {
    return this.templates.preview(
      context,
      params.key,
      body.language,
      body.content,
    );
  }

  @RequirePermission('notificationTemplate.manage')
  @ContractRoute(api.sendTestTemplate)
  sendTestTemplate(
    @CurrentContext() context: RequestContext,
    @ContractInput() { params, body }: RouteInput<typeof api.sendTestTemplate>,
  ): Promise<RouteSuccess<typeof api.sendTestTemplate>> {
    return this.templates.sendTest(context, params.key, body.language);
  }
}
