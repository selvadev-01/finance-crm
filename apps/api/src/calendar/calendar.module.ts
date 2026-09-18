import { Module } from '@nestjs/common';

import { HolidayController } from './holiday.controller.js';
import { HolidayService } from './holiday.service.js';

/**
 * M06 Working calendar — declared holidays (US-093). The working-day
 * arithmetic itself is pure and lives in `packages/domain`.
 */
@Module({
  controllers: [HolidayController],
  providers: [HolidayService],
})
export class CalendarModule {}
