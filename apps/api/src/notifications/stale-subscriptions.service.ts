import { Injectable } from '@nestjs/common';

import type { SystemContext } from '../platform/context/system-context.js';
import { Database } from '../platform/database/database.js';

/** M14 `deactivate-stale-subscriptions`: a device unseen this long is gone. */
export const STALE_AFTER_DAYS = 90;
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * M10 / M14: a phone that has not registered for 90 days — sold, reset, or its
 * app uninstalled — is deactivated exactly as a `410 Gone` deactivates one:
 * `isActive` false, and its still-pending pushes expire. Its notifications
 * stay in the centre; only delivery to that device stops.
 *
 * One organization per run: a subscription belongs to a user, and the user to
 * the organization through their staff profile. Running it again changes
 * nothing.
 */
@Injectable()
export class StaleSubscriptionService {
  constructor(private readonly database: Database) {}

  deactivate(
    system: SystemContext,
    now: Date = new Date(),
  ): Promise<{ deactivated: number }> {
    const cutoff = new Date(now.getTime() - STALE_AFTER_DAYS * DAY_MS);
    return this.database.transaction(async (tx) => {
      const stale = await tx.pushSubscription.findMany({
        where: {
          isActive: true,
          lastSeenAt: { lt: cutoff },
          user: { staffProfile: { organizationId: system.organizationId } },
        },
        select: { id: true },
      });
      const ids = stale.map((row) => row.id);
      if (ids.length === 0) return { deactivated: 0 };
      await tx.pushSubscription.updateMany({
        where: { id: { in: ids } },
        data: { isActive: false },
      });
      await tx.notificationOutbox.updateMany({
        where: { pushSubscriptionId: { in: ids }, status: 'PENDING' },
        data: { status: 'EXPIRED' },
      });
      return { deactivated: ids.length };
    });
  }
}
