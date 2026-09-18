import { Injectable } from '@nestjs/common';

import { Database } from '../platform/database/database.js';
import { builtInNumber, type IntegerSettingKey } from './setting-registry.js';

/**
 * The effective value of a business setting, for the code that consumes it
 * (M15). Defaults live in `setting-registry.ts`; the `setting` table holds
 * overrides only, so a missing row is not an error — it is the default.
 *
 * A stored value that is not the shape the registry expects also falls back to
 * the default rather than throwing: a settings row must never be able to take
 * the collection path down (M15's first risk).
 */
@Injectable()
export class SettingReader {
  constructor(private readonly database: Database) {}

  async number(
    organizationId: string,
    key: IntegerSettingKey,
  ): Promise<number> {
    const row = await this.database.client.setting.findUnique({
      where: { organizationId_key: { organizationId, key } },
      select: { value: true },
    });
    return asWholeNumber(row?.value) ?? builtInNumber(key);
  }
}

function asWholeNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isInteger(value) && value >= 0) {
    return value;
  }
  if (typeof value === 'string' && /^\d{1,6}$/.test(value)) {
    return Number(value);
  }
  return undefined;
}
