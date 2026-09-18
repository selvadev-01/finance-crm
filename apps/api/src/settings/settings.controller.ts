import { Controller } from '@nestjs/common';
import {
  type RouteInput,
  type RouteSuccess,
  settingsContract as api,
} from '@repo/contracts';

import { CurrentContext, RequirePermission } from '../access/decorators.js';
import type { RequestContext } from '../platform/context/request-context.js';
import {
  ContractInput,
  ContractRoute,
} from '../platform/contract/contract-route.js';
import { SettingsService } from './settings.service.js';

/**
 * M15 business settings (US-094). Both routes are Super Admin only: reading
 * the settings shows how the business behaves, and changing one alters it for
 * everyone (rbac-matrix.md, Administration).
 */
@Controller()
export class SettingsController {
  constructor(private readonly settings: SettingsService) {}

  @RequirePermission('settings.view')
  @ContractRoute(api.getSettings)
  getSettings(
    @CurrentContext() context: RequestContext,
  ): Promise<RouteSuccess<typeof api.getSettings>> {
    return this.settings.list(context);
  }

  @RequirePermission('settings.change')
  @ContractRoute(api.updateSetting)
  updateSetting(
    @CurrentContext() context: RequestContext,
    @ContractInput() { params, body }: RouteInput<typeof api.updateSetting>,
  ): Promise<RouteSuccess<typeof api.updateSetting>> {
    return this.settings.update(context, params.key, body.value);
  }
}
