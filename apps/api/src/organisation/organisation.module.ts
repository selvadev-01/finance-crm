import { Module } from '@nestjs/common';

import { AssignmentService } from './assignment.service.js';
import { LineService } from './line.service.js';
import { OrganisationController } from './organisation.controller.js';
import { SectorService } from './sector.service.js';
import { StaffingService } from './staffing.service.js';
import { VisitingOrderService } from './visiting-order.service.js';

/** M03 Organisation — sectors, lines, staff assignment and visiting order. */
@Module({
  controllers: [OrganisationController],
  providers: [
    SectorService,
    LineService,
    AssignmentService,
    StaffingService,
    VisitingOrderService,
  ],
  exports: [SectorService, LineService, AssignmentService],
})
export class OrganisationModule {}
