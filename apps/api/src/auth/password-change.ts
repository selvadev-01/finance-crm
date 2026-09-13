import type { PrismaClient } from '@repo/db';

import { Database } from '../platform/database/database.js';

/**
 * Completing a forced password change (US-003).
 *
 * When a staff member whose password an Admin reset changes it through Better
 * Auth's `/change-password`, `mustChangePassword` is cleared and the change is
 * audited. Both statements run in one transaction: the flag must not
 * clear without its audit entry.
 *
 * Like `signInAudit`, it is an object with a method so HTTP tests can replace
 * the audited write — `audit_log` rejects DELETE.
 */
export const passwordChange: {
  complete: (userId: string) => Promise<void>;
} = {
  complete: () => {
    throw new Error('passwordChange.complete is not configured');
  },
};

export async function completePasswordChange(
  client: PrismaClient,
  userId: string,
): Promise<void> {
  const staff = await client.staffProfile.findFirst({
    where: { userId, mustChangePassword: true },
    select: { id: true },
  });
  if (!staff) return;

  // Outside Nest, but still through `Database` rather than `$transaction`:
  // it joins an enclosing transaction instead of opening an independent one
  // on another connection (M16), so Tier 1 tests exercise the real write.
  await new Database(client).transaction(async (tx) => {
    await tx.staffProfile.update({
      where: { id: staff.id },
      data: { mustChangePassword: false },
    });
    await tx.auditLog.create({
      data: {
        actorUserId: userId,
        entityTable: 'staff_profile',
        entityId: staff.id,
        action: 'UPDATE',
        before: { mustChangePassword: true },
        after: { mustChangePassword: false, passwordChanged: true },
      },
    });
  });
}
