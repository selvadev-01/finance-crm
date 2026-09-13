import { Controller } from '@nestjs/common';
import {
  type RouteInput,
  type RouteSuccess,
  staffContract as api,
} from '@repo/contracts';

import { CurrentContext, RequirePermission } from '../access/decorators.js';
import type { RequestContext } from '../platform/context/request-context.js';
import {
  ContractInput,
  ContractRoute,
} from '../platform/contract/contract-route.js';
import { StaffPasswordService } from './staff-password.service.js';

/** M01 staff administration endpoints. */
@Controller()
export class StaffController {
  constructor(private readonly passwords: StaffPasswordService) {}

  @RequirePermission('staff.resetPassword')
  @ContractRoute(api.resetStaffPassword)
  resetStaffPassword(
    @CurrentContext() context: RequestContext,
    @ContractInput()
    { params }: RouteInput<typeof api.resetStaffPassword>,
  ): Promise<RouteSuccess<typeof api.resetStaffPassword>> {
    return this.passwords.resetPassword(context, params.staffProfileId);
  }
}
