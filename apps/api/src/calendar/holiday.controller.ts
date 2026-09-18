import { Controller } from '@nestjs/common';
import {
  holidayContract as api,
  type RouteInput,
  type RouteSuccess,
} from '@repo/contracts';

import { CurrentContext, RequirePermission } from '../access/decorators.js';
import type { RequestContext } from '../platform/context/request-context.js';
import {
  ContractInput,
  ContractRoute,
} from '../platform/contract/contract-route.js';
import { HolidayService } from './holiday.service.js';

type In<Route extends keyof typeof api> = RouteInput<(typeof api)[Route]>;
type Out<Route extends keyof typeof api> = Promise<
  RouteSuccess<(typeof api)[Route]>
>;

/** M06 holiday endpoints (US-093). Scope is applied inside the service (M02). */
@Controller()
export class HolidayController {
  constructor(private readonly holidays: HolidayService) {}

  @RequirePermission('holiday.view')
  @ContractRoute(api.listHolidays)
  listHolidays(
    @CurrentContext() context: RequestContext,
    @ContractInput() { query }: In<'listHolidays'>,
  ): Out<'listHolidays'> {
    return this.holidays.list(context, query);
  }

  @RequirePermission('holiday.declare')
  @ContractRoute(api.declareHoliday)
  declareHoliday(
    @CurrentContext() context: RequestContext,
    @ContractInput() { body }: In<'declareHoliday'>,
  ): Out<'declareHoliday'> {
    return this.holidays.declare(context, body);
  }

  @RequirePermission('holiday.declare')
  @ContractRoute(api.removeHoliday)
  removeHoliday(
    @CurrentContext() context: RequestContext,
    @ContractInput() { params }: In<'removeHoliday'>,
  ): Out<'removeHoliday'> {
    return this.holidays.remove(context, params.holidayId);
  }
}
