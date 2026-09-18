import { Module } from '@nestjs/common';

import { SettingReader } from './setting-reader.js';
import { SettingsController } from './settings.controller.js';
import { SettingsService } from './settings.service.js';

/**
 * M15 Settings — the business rules a Super Admin may change without a
 * deployment (US-094). Infrastructure configuration is `APP_CONFIG` (M16) and
 * never lives here.
 *
 * `SettingReader` is exported because the consumers live in other modules: the
 * overdue job (M05) reads the grace days, and `/api/me` carries the default
 * term to the account form.
 */
@Module({
  controllers: [SettingsController],
  providers: [SettingsService, SettingReader],
  exports: [SettingReader],
})
export class SettingsModule {}
