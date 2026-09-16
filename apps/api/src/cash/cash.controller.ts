import { Controller } from '@nestjs/common';
import {
  cashContract as api,
  type RouteInput,
  type RouteSuccess,
} from '@repo/contracts';
import { parseCalendarDate } from '@repo/domain';

import { CurrentContext, RequirePermission } from '../access/decorators.js';
import type { RequestContext } from '../platform/context/request-context.js';
import {
  ContractInput,
  ContractRoute,
} from '../platform/contract/contract-route.js';
import { DayCloseService } from './day-close.service.js';
import { DeviceSyncService } from './device-sync.service.js';
import { HandoverService } from './handover.service.js';

/** M08 Day close and cash control. Scope is applied in the services (M02). */
@Controller()
export class CashController {
  constructor(
    private readonly devices: DeviceSyncService,
    private readonly dayCloses: DayCloseService,
    private readonly handovers: HandoverService,
  ) {}

  /**
   * The phone's queue, so S-05 can name Juniors who have not synced. Reuses
   * `collection.record`: only a phone that records collections reports.
   */
  @RequirePermission('collection.record')
  @ContractRoute(api.reportSync)
  reportSync(
    @CurrentContext() context: RequestContext,
    @ContractInput() { body }: RouteInput<typeof api.reportSync>,
  ): Promise<RouteSuccess<typeof api.reportSync>> {
    return this.devices.report(context, body);
  }

  @RequirePermission('dayClose.view')
  @ContractRoute(api.getDayClose)
  getDayClose(
    @CurrentContext() context: RequestContext,
    @ContractInput() { params }: RouteInput<typeof api.getDayClose>,
  ): Promise<RouteSuccess<typeof api.getDayClose>> {
    return this.dayCloses.view(
      context,
      params.lineId,
      parseCalendarDate(params.businessDate),
    );
  }

  @RequirePermission('dayClose.close')
  @ContractRoute(api.closeDay)
  closeDay(
    @CurrentContext() context: RequestContext,
    @ContractInput() { params, body }: RouteInput<typeof api.closeDay>,
  ): Promise<RouteSuccess<typeof api.closeDay>> {
    return this.dayCloses.close(
      context,
      params.lineId,
      parseCalendarDate(params.businessDate),
      body.confirmUnsynced ?? false,
    );
  }

  @RequirePermission('dayClose.reopen')
  @ContractRoute(api.reopenDay)
  reopenDay(
    @CurrentContext() context: RequestContext,
    @ContractInput() { params, body }: RouteInput<typeof api.reopenDay>,
  ): Promise<RouteSuccess<typeof api.reopenDay>> {
    return this.dayCloses.reopen(
      context,
      params.lineId,
      parseCalendarDate(params.businessDate),
      body.reason,
    );
  }

  @RequirePermission('handover.initiate')
  @ContractRoute(api.getCashPosition)
  getCashPosition(
    @CurrentContext() context: RequestContext,
  ): Promise<RouteSuccess<typeof api.getCashPosition>> {
    return this.handovers.position(context);
  }

  @RequirePermission('handover.initiate')
  @ContractRoute(api.handOver)
  handOver(
    @CurrentContext() context: RequestContext,
    @ContractInput() { body }: RouteInput<typeof api.handOver>,
  ): Promise<RouteSuccess<typeof api.handOver>> {
    return this.handovers.handOver(context, body);
  }

  @RequirePermission('handover.acknowledge')
  @ContractRoute(api.listHandovers)
  listHandovers(
    @CurrentContext() context: RequestContext,
    @ContractInput() { query }: RouteInput<typeof api.listHandovers>,
  ): Promise<RouteSuccess<typeof api.listHandovers>> {
    return this.handovers.list(context, query.status);
  }

  @RequirePermission('handover.acknowledge')
  @ContractRoute(api.acknowledgeHandover)
  acknowledgeHandover(
    @CurrentContext() context: RequestContext,
    @ContractInput() { params }: RouteInput<typeof api.acknowledgeHandover>,
  ): Promise<RouteSuccess<typeof api.acknowledgeHandover>> {
    return this.handovers.acknowledge(context, params.handoverId);
  }

  @RequirePermission('handover.dispute')
  @ContractRoute(api.disputeHandover)
  disputeHandover(
    @CurrentContext() context: RequestContext,
    @ContractInput() { params, body }: RouteInput<typeof api.disputeHandover>,
  ): Promise<RouteSuccess<typeof api.disputeHandover>> {
    return this.handovers.dispute(context, params.handoverId, body.note);
  }
}
