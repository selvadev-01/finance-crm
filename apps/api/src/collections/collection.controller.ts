import { Controller, StreamableFile } from '@nestjs/common';
import {
  collectionContract as api,
  exportContract as download,
  type RouteInput,
  type RouteSuccess,
} from '@repo/contracts';

import { CurrentContext, RequirePermission } from '../access/decorators.js';
import {
  EXPORT_PAGE_SIZE,
  ExportService,
  readAllPages,
} from '../exports/export.service.js';
import type { RequestContext } from '../platform/context/request-context.js';
import {
  ContractInput,
  ContractRoute,
  Replayed,
} from '../platform/contract/contract-route.js';
import { collectionListDocument } from './collection-export.js';
import { CollectionHistoryService } from './collection-history.service.js';
import { CollectionService } from './collection.service.js';
import { CorrectionService } from './correction.service.js';
import { RouteService } from './route.service.js';

/** M07 Collections. Scope is applied in the services (M02). */
@Controller()
export class CollectionController {
  constructor(
    private readonly collections: CollectionService,
    private readonly routes: RouteService,
    private readonly history: CollectionHistoryService,
    private readonly corrections: CorrectionService,
    private readonly exporter: ExportService,
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

  /** S-16 — date-bounded, in the caller's scope (M02). */
  @RequirePermission('collection.view')
  @ContractRoute(api.listCollections)
  listCollections(
    @CurrentContext() context: RequestContext,
    @ContractInput() { query }: RouteInput<typeof api.listCollections>,
  ): Promise<RouteSuccess<typeof api.listCollections>> {
    return this.history.list(context, query);
  }

  /** US-022 — one customer’s whole history, newest first, in scope. */
  @RequirePermission('collection.view')
  @ContractRoute(api.listCustomerCollections)
  listCustomerCollections(
    @CurrentContext() context: RequestContext,
    @ContractInput()
    { params, query }: RouteInput<typeof api.listCustomerCollections>,
  ): Promise<RouteSuccess<typeof api.listCustomerCollections>> {
    return this.history.forCustomer(context, params.customerId, query);
  }

  /**
   * S-16 as Excel or PDF (M12): every entry the list's filters match, read
   * through the list itself, and recorded as an EXPORT in the audit log (M13).
   */
  @RequirePermission('collection.view')
  @ContractRoute(download.collections)
  async exportCollections(
    @CurrentContext() context: RequestContext,
    @ContractInput()
    { query: { format, ...filters } }: RouteInput<typeof download.collections>,
  ): Promise<StreamableFile> {
    const { rows } = await readAllPages((cursor) =>
      this.history.list(context, {
        ...filters,
        cursor,
        limit: EXPORT_PAGE_SIZE,
      }),
    );
    return this.exporter.deliver(
      context,
      { name: 'collections', format, filters },
      collectionListDocument(rows, filters, new Date()),
    );
  }

  /** S-17 — the collection, its adjustments and their approvals. */
  @RequirePermission('collection.view')
  @ContractRoute(api.getCollection)
  getCollection(
    @CurrentContext() context: RequestContext,
    @ContractInput() { params }: RouteInput<typeof api.getCollection>,
  ): Promise<RouteSuccess<typeof api.getCollection>> {
    return this.history.get(context, params.collectionId);
  }

  /** US-044 — a pending ADJUSTMENT; nothing moves until approved. */
  @RequirePermission('collection.requestCorrection')
  @ContractRoute(api.requestCorrection)
  requestCorrection(
    @CurrentContext() context: RequestContext,
    @ContractInput() { params, body }: RouteInput<typeof api.requestCorrection>,
  ): Promise<RouteSuccess<typeof api.requestCorrection>> {
    return this.corrections.request(context, params.collectionId, body);
  }

  /** BR-14 — a correction to ₹0, by an Admin, still approved by someone else. */
  @RequirePermission('collection.reverse')
  @ContractRoute(api.requestReversal)
  requestReversal(
    @CurrentContext() context: RequestContext,
    @ContractInput() { params, body }: RouteInput<typeof api.requestReversal>,
  ): Promise<RouteSuccess<typeof api.requestReversal>> {
    return this.corrections.reverse(context, params.collectionId, body);
  }

  /** S-18 — corrections in the approver's scope. */
  @RequirePermission('collection.approveCorrection')
  @ContractRoute(api.listApprovals)
  listApprovals(
    @CurrentContext() context: RequestContext,
    @ContractInput() { query }: RouteInput<typeof api.listApprovals>,
  ): Promise<RouteSuccess<typeof api.listApprovals>> {
    return this.corrections.listApprovals(context, query);
  }

  /** Approve or reject — never one's own request. */
  @RequirePermission('collection.approveCorrection')
  @ContractRoute(api.decideApproval)
  decideApproval(
    @CurrentContext() context: RequestContext,
    @ContractInput() { params, body }: RouteInput<typeof api.decideApproval>,
  ): Promise<RouteSuccess<typeof api.decideApproval>> {
    return this.corrections.decide(context, params.approvalId, body);
  }
}
