import { Injectable } from '@nestjs/common';

import type { SystemContext } from '../platform/context/system-context.js';
import { Database } from '../platform/database/database.js';

/**
 * BR-13 — idempotency keys are kept 90 days, then purged (M14
 * `purge-idempotency-keys`). A key past `expiresAt` can no longer be replayed;
 * a phone offline longer than that has far bigger problems than a duplicate.
 *
 * Scoped to the organization through the staff who recorded them. Idempotent:
 * a second run finds nothing expired.
 */
@Injectable()
export class IdempotencyPurgeService {
  constructor(private readonly database: Database) {}

  async purge(
    system: SystemContext,
    now: Date = new Date(),
  ): Promise<{ purged: number }> {
    return this.database.transaction(async (tx) => {
      const staff = await tx.staffProfile.findMany({
        where: { organizationId: system.organizationId },
        select: { userId: true },
      });
      const purged = await tx.idempotencyKey.deleteMany({
        where: {
          userId: { in: staff.map((member) => member.userId) },
          expiresAt: { lt: now },
        },
      });
      return { purged: purged.count };
    });
  }
}
