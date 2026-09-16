import { Injectable } from '@nestjs/common';

import type { RequestContext } from '../platform/context/request-context.js';
import { Database } from '../platform/database/database.js';

/**
 * What a Junior's phone last said about its outbox (US-060, decided
 * 2026-09-14). The server cannot see a phone's queue; the phone reports it
 * after each drain and route refresh, and S-05 names Juniors whose phone still
 * holds collections for the day being closed. One row per staff member,
 * replaced each time — a second phone overwrites the first.
 */
@Injectable()
export class DeviceSyncService {
  constructor(private readonly database: Database) {}

  report(
    context: RequestContext,
    input: { unsentCount: number; oldestUnsentAt?: string | undefined },
    now: Date = new Date(),
  ): Promise<{ reportedAt: string }> {
    const data = {
      unsentCount: input.unsentCount,
      // A phone with unsent collections that could not say when: assume now.
      oldestUnsentAt:
        input.unsentCount === 0
          ? null
          : input.oldestUnsentAt
            ? new Date(input.oldestUnsentAt)
            : now,
      reportedAt: now,
    };
    return this.database.transaction(async (tx) => {
      await tx.deviceSyncReport.upsert({
        where: { staffProfileId: context.staffProfileId },
        create: { staffProfileId: context.staffProfileId, ...data },
        update: data,
      });
      return { reportedAt: now.toISOString() };
    });
  }
}
