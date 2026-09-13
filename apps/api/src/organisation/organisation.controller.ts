import { Controller } from '@nestjs/common';
import {
  organisationContract as api,
  type RouteInput,
  type RouteSuccess,
} from '@repo/contracts';

import { CurrentContext, RequirePermission } from '../access/decorators.js';
import type { RequestContext } from '../platform/context/request-context.js';
import {
  ContractInput,
  ContractRoute,
} from '../platform/contract/contract-route.js';
import { AssignmentService } from './assignment.service.js';
import { LineService } from './line.service.js';
import { SectorService } from './sector.service.js';

type In<Route extends keyof typeof api> = RouteInput<(typeof api)[Route]>;
type Out<Route extends keyof typeof api> = Promise<
  RouteSuccess<(typeof api)[Route]>
>;

/**
 * M03 Organisation endpoints. Permissions follow the RBAC matrix; scope is
 * applied inside the services (M02).
 */
@Controller()
export class OrganisationController {
  constructor(
    private readonly sectors: SectorService,
    private readonly lines: LineService,
    private readonly assignments: AssignmentService,
  ) {}

  @RequirePermission('organisation.view')
  @ContractRoute(api.listSectors)
  listSectors(
    @CurrentContext() context: RequestContext,
    @ContractInput() { query }: In<'listSectors'>,
  ): Out<'listSectors'> {
    return this.sectors.list(context, query);
  }

  @RequirePermission('sector.manage')
  @ContractRoute(api.createSector)
  createSector(
    @CurrentContext() context: RequestContext,
    @ContractInput() { body }: In<'createSector'>,
  ): Out<'createSector'> {
    return this.sectors.create(context, body);
  }

  @RequirePermission('sector.manage')
  @ContractRoute(api.updateSector)
  updateSector(
    @CurrentContext() context: RequestContext,
    @ContractInput() { params, body }: In<'updateSector'>,
  ): Out<'updateSector'> {
    return this.sectors.rename(context, params.sectorId, body.name);
  }

  @RequirePermission('sector.manage')
  @ContractRoute(api.deactivateSector)
  deactivateSector(
    @CurrentContext() context: RequestContext,
    @ContractInput() { params }: In<'deactivateSector'>,
  ): Out<'deactivateSector'> {
    return this.sectors.deactivate(context, params.sectorId);
  }

  @RequirePermission('organisation.view')
  @ContractRoute(api.listLines)
  listLines(
    @CurrentContext() context: RequestContext,
    @ContractInput() { query }: In<'listLines'>,
  ): Out<'listLines'> {
    return this.lines.list(context, query);
  }

  @RequirePermission('line.manage')
  @ContractRoute(api.createLine)
  createLine(
    @CurrentContext() context: RequestContext,
    @ContractInput() { body }: In<'createLine'>,
  ): Out<'createLine'> {
    return this.lines.create(context, body);
  }

  @RequirePermission('line.manage')
  @ContractRoute(api.updateLine)
  updateLine(
    @CurrentContext() context: RequestContext,
    @ContractInput() { params, body }: In<'updateLine'>,
  ): Out<'updateLine'> {
    return this.lines.rename(context, params.lineId, body.name);
  }

  @RequirePermission('line.manage')
  @ContractRoute(api.deactivateLine)
  deactivateLine(
    @CurrentContext() context: RequestContext,
    @ContractInput() { params }: In<'deactivateLine'>,
  ): Out<'deactivateLine'> {
    return this.lines.deactivate(context, params.lineId);
  }

  @RequirePermission('assignment.assignSenior')
  @ContractRoute(api.assignSenior)
  assignSenior(
    @CurrentContext() context: RequestContext,
    @ContractInput() { params, body }: In<'assignSenior'>,
  ): Out<'assignSenior'> {
    return this.assignments.assignSenior(context, params.lineId, body);
  }

  @RequirePermission('assignment.moveJunior')
  @ContractRoute(api.assignJunior)
  assignJunior(
    @CurrentContext() context: RequestContext,
    @ContractInput() { params, body }: In<'assignJunior'>,
  ): Out<'assignJunior'> {
    return this.assignments.assignJunior(context, params.lineId, body);
  }
}
