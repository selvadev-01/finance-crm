import { Module } from '@nestjs/common';

import { AssignmentService } from './assignment.service.js';
import { LineService } from './line.service.js';
import { OrganisationController } from './organisation.controller.js';
import { SectorService } from './sector.service.js';
import { StaffingService } from './staffing.service.js';

/** M03 Organisation — sectors, lines and staff assignment. */
@Module({
  controllers: [OrganisationController],
  providers: [SectorService, LineService, AssignmentService, StaffingService],
  exports: [SectorService, LineService, AssignmentService],
})
export class OrganisationModule {}
