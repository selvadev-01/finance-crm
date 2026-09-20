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
import { SettingReader } from '../settings/setting-reader.js';
import { StaffAdminService } from './staff-admin.service.js';
import { StaffDirectoryService } from './staff-directory.service.js';
import { StaffPasswordService } from './staff-password.service.js';

/** M01 staff administration endpoints. */
@Controller()
export class StaffController {
  constructor(
    private readonly passwords: StaffPasswordService,
    private readonly directory: StaffDirectoryService,
    private readonly admin: StaffAdminService,
    private readonly database: Database,
    private readonly settings: SettingReader,
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
    const [user, organization, defaultTermDays] = await Promise.all([
      this.database.client.user.findUniqueOrThrow({
        where: { id: context.userId },
        select: { name: true, email: true },
      }),
      this.database.client.organization.findUniqueOrThrow({
        where: { id: context.organizationId },
        select: { name: true, slug: true },
      }),
      // M15: what the account form starts N at (US-094). Carried here rather
      // than read from /api/settings, which is the Super Admin's alone.
      // Deliberately sent to every role: a non-sensitive integer, so the
      // account form has its default whoever is signed in.
      this.settings.number(context.organizationId, 'account.defaultTermDays'),
    ]);
    return {
      userId: context.userId,
      staffProfileId: context.staffProfileId,
      name: user.name,
      email: user.email,
      role: context.role,
      currentLineId: context.currentLineId,
      organization: { ...organization, defaultTermDays },
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

  @RequirePermission('staff.create')
  @ContractRoute(api.createStaff)
  createStaff(
    @CurrentContext() context: RequestContext,
    @ContractInput() { body }: RouteInput<typeof api.createStaff>,
  ): Promise<RouteSuccess<typeof api.createStaff>> {
    return this.admin.create(context, body);
  }

  @RequirePermission('staff.update')
  @ContractRoute(api.updateStaff)
  updateStaff(
    @CurrentContext() context: RequestContext,
    @ContractInput() { params, body }: RouteInput<typeof api.updateStaff>,
  ): Promise<RouteSuccess<typeof api.updateStaff>> {
    return this.admin.update(context, params.staffProfileId, body);
  }

  @RequirePermission('staff.changeRole')
  @ContractRoute(api.changeStaffRole)
  changeStaffRole(
    @CurrentContext() context: RequestContext,
    @ContractInput() { params, body }: RouteInput<typeof api.changeStaffRole>,
  ): Promise<RouteSuccess<typeof api.changeStaffRole>> {
    return this.admin.changeRole(context, params.staffProfileId, body.role);
  }

  @RequirePermission('staff.suspend')
  @ContractRoute(api.changeStaffStatus)
  changeStaffStatus(
    @CurrentContext() context: RequestContext,
    @ContractInput() { params, body }: RouteInput<typeof api.changeStaffStatus>,
  ): Promise<RouteSuccess<typeof api.changeStaffStatus>> {
    return this.admin.changeStatus(context, params.staffProfileId, body);
  }

  /** US-092: soft delete, Super Admin only. Blocked, never acknowledged away. */
  @RequirePermission('staff.delete')
  @ContractRoute(api.deleteStaff)
  deleteStaff(
    @CurrentContext() context: RequestContext,
    @ContractInput() { params }: RouteInput<typeof api.deleteStaff>,
  ): Promise<RouteSuccess<typeof api.deleteStaff>> {
    return this.admin.softDelete(context, params.staffProfileId);
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
