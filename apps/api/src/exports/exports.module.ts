import { Module } from '@nestjs/common';

import { ExportService } from './export.service.js';

/**
 * M12 export: renders a view's document as Excel or PDF and records the
 * EXPORT (M13). Owns no routes — each export lives beside the view it
 * exports, under that view's permission — and no data.
 */
@Module({
  providers: [ExportService],
  exports: [ExportService],
})
export class ExportsModule {}
