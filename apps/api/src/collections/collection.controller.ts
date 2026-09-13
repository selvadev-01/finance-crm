import { Controller } from '@nestjs/common';
import {
  collectionContract as api,
  type RouteInput,
  type RouteSuccess,
} from '@repo/contracts';

import { CurrentContext, RequirePermission } from '../access/decorators.js';
import type { RequestContext } from '../platform/context/request-context.js';
import {
  ContractInput,
  ContractRoute,
  Replayed,
} from '../platform/contract/contract-route.js';
import { CollectionService } from './collection.service.js';
import { RouteService } from './route.service.js';

/** M07 Collections. Scope is applied in the services (M02). */
@Controller()
export class CollectionController {
  constructor(
    private readonly collections: CollectionService,
    private readonly routes: RouteService,
  ) {}

  /** `201` when recorded now; `200` with the original body on a replay (BR-13). */
  @RequirePermission('collection.record')
  @ContractRoute(api.recordCollection)
  async recordCollection(
    @CurrentContext() context: RequestContext,
    @ContractInput() { body }: RouteInput<typeof api.recordCollection>,
  ): Promise<
    | RouteSuccess<typeof api.recordCollection>
    | Replayed<RouteSuccess<typeof api.recordCollection>>
  > {
    const result = await this.collections.record(context, body);
    return result.replayed
      ? new Replayed(result.collection)
      : result.collection;
  }

  /** The route is what a Junior records against, so it carries the same permission. */
  @RequirePermission('collection.record')
  @ContractRoute(api.getRoute)
  getRoute(
    @CurrentContext() context: RequestContext,
  ): Promise<RouteSuccess<typeof api.getRoute>> {
    return this.routes.route(context);
  }
}
