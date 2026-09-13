import { Injectable } from '@nestjs/common';
import type { PasswordReset } from '@repo/contracts';

import { AuditWriter } from '../audit/audit.writer.js';
import type { RequestContext } from '../platform/context/request-context.js';
import { Database } from '../platform/database/database.js';
import {
  AuthorizationError,
  DomainError,
  NotFoundError,
} from '../platform/errors/errors.js';
import { PasswordHasher } from './password-hasher.js';
import { generateTemporaryPassword } from './temporary-password.js';

/**
 * Admin-initiated password reset (M01, US-003) — for field staff without
 * email access. Decided 2026-09-13: no self-service email reset until an email
 * provider exists.
 *
 * In one transaction: the credential gets a new hash, **every session the
 * staff member holds is deleted** (a lost or stolen phone stops working at
 * once), `mustChangePassword` is set, and the reset is audited. The temporary
 * password itself is returned once and appears nowhere else — not in the
 * database, a log line or the audit entry.
 */
@Injectable()
export class StaffPasswordService {
  constructor(
    private readonly database: Database,
    private readonly audit: AuditWriter,
    private readonly hasher: PasswordHasher,
  ) {}

  async resetPassword(
    context: RequestContext,
    staffProfileId: string,
  ): Promise<PasswordReset> {
    const target = await this.database.client.staffProfile.findFirst({
      where: {
        id: staffProfileId,
        organizationId: context.organizationId,
        deletedAt: null,
      },
      select: { id: true, userId: true, role: true },
    });
    if (!target) {
      throw new NotFoundError('STAFF_NOT_FOUND', 'Staff not found');
    }
    if (target.id === context.staffProfileId) {
      throw new DomainError(
        'CANNOT_RESET_OWN_PASSWORD',
        'Change your own password from your account, not with a reset',
      );
    }
    // Otherwise an Admin could take over the owner's account.
    if (target.role === 'SUPER_ADMIN' && context.role !== 'SUPER_ADMIN') {
      throw new AuthorizationError(
        'CANNOT_RESET_SUPER_ADMIN',
        "Only a Super Admin can reset a Super Admin's password",
      );
    }

    const temporaryPassword = generateTemporaryPassword();
    // Hashing is deliberately slow; do it before the transaction opens.
    const hash = await this.hasher.hash(temporaryPassword);

    return this.database.transaction(async (tx) => {
      const credential = await tx.account.updateMany({
        where: { userId: target.userId, providerId: 'credential' },
        data: { password: hash },
      });
      if (credential.count === 0) {
        throw new DomainError(
          'NO_PASSWORD_CREDENTIAL',
          'This staff member has no password to reset',
        );
      }
      const revoked = await tx.session.deleteMany({
        where: { userId: target.userId },
      });
      await tx.staffProfile.update({
        where: { id: target.id },
        data: { mustChangePassword: true },
      });
      await this.audit.record(context, {
        action: 'UPDATE',
        entityTable: 'staff_profile',
        entityId: target.id,
        before: { mustChangePassword: false },
        after: {
          mustChangePassword: true,
          passwordReset: true,
          sessionsRevoked: revoked.count,
        },
      });
      return { temporaryPassword, sessionsRevoked: revoked.count };
    });
  }
}
