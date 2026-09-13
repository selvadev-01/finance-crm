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
import { Database } from '../platform/database/database.js';
import { StaffDirectoryService } from './staff-directory.service.js';
import { StaffPasswordService } from './staff-password.service.js';

/** M01 staff administration endpoints. */
@Controller()
export class StaffController {
  constructor(
    private readonly passwords: StaffPasswordService,
    private readonly directory: StaffDirectoryService,
    private readonly database: Database,
  ) {}

  /**
   * Who is signed in, for the web app's role landing. Reached only after
   * PolicyGuard: an inactive account gets `401 STAFF_NOT_ACTIVE`, and a
   * pending forced password change `403 PASSWORD_CHANGE_REQUIRED` — which is
   * how the client learns to show the change-password screen.
   */
  @RequirePermission('profile.viewOwn')
  @ContractRoute(api.me)
  async me(
    @CurrentContext() context: RequestContext,
  ): Promise<RouteSuccess<typeof api.me>> {
    const user = await this.database.client.user.findUniqueOrThrow({
      where: { id: context.userId },
      select: { name: true, email: true },
    });
    return {
      userId: context.userId,
      staffProfileId: context.staffProfileId,
      name: user.name,
      email: user.email,
      role: context.role,
      currentLineId: context.currentLineId,
    };
  }

  @RequirePermission('staff.list')
  @ContractRoute(api.listStaff)
  listStaff(
    @CurrentContext() context: RequestContext,
    @ContractInput() { query }: RouteInput<typeof api.listStaff>,
  ): Promise<RouteSuccess<typeof api.listStaff>> {
    return this.directory.list(context, query);
  }

  @RequirePermission('staff.list')
  @ContractRoute(api.getStaff)
  getStaff(
    @CurrentContext() context: RequestContext,
    @ContractInput() { params }: RouteInput<typeof api.getStaff>,
  ): Promise<RouteSuccess<typeof api.getStaff>> {
    return this.directory.get(context, params.staffProfileId);
  }

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
