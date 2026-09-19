import type { PrismaClient } from '@repo/db';
import { randomUUID } from 'node:crypto';

import type { RequestContext } from '../../src/platform/context/request-context.js';
import {
  AuthorizationError,
  ConflictError,
  DomainError,
  InternalError,
  NotFoundError,
} from '../../src/platform/errors/errors.js';
import { createTestPrismaClient } from '../database.js';
import { createLine, createStaff } from '../db-constraints/fixtures.js';
import { withRollback } from '../with-rollback.js';
import {
  failingRecorder,
  recorderLog,
  TEST_ROUTE,
  testRecorder,
} from './recorder.js';

/**
 * The recorder itself (M13, ADR-0014), against real rows, rolled back.
 *
 * Three things have to hold, and the third is the one that matters at three in
 * the morning: a refusal that cannot be recorded is still a refusal, and the
 * caller must never learn the difference.
 */
describe('SecurityEventRecorder (ADR-0014)', () => {
  let prisma: PrismaClient;

  beforeAll(() => {
    prisma = createTestPrismaClient();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  async function world(tx: PrismaClient) {
    const { organization } = await createLine(tx);
    const actor = await createStaff(tx, organization.id, 'ADMIN');
    const context: RequestContext = {
      requestId: `req_${randomUUID()}`,
      userId: actor.userId,
      staffProfileId: actor.id,
      organizationId: organization.id,
      role: 'ADMIN',
      currentLineId: null,
    };
    const rows = () =>
      tx.securityEvent.findMany({
        where: { organizationId: organization.id },
        orderBy: { createdAt: 'asc' },
      });
    return { context, organization, rows };
  }

  it('records who attempted what, against whom, and why it was refused', async () => {
    await withRollback(prisma, async (tx) => {
      const { context, organization, rows } = await world(tx);
      const targetId = randomUUID();

      await testRecorder(tx).refused(
        context,
        new AuthorizationError(
          'CANNOT_MANAGE_HIGHER_ROLE',
          'Only a Super Admin can change another Super Admin.',
        ),
        { id: targetId, detail: { targetRole: 'SUPER_ADMIN' } },
      );

      expect(await rows()).toMatchObject([
        {
          organizationId: organization.id,
          actorUserId: context.userId,
          actorRole: 'ADMIN',
          kind: 'RANK_GUARD',
          code: 'CANNOT_MANAGE_HIGHER_ROLE',
          status: 403,
          method: TEST_ROUTE.method,
          path: TEST_ROUTE.path,
          targetTable: 'staff_profile',
          targetId,
          detail: { targetRole: 'SUPER_ADMIN' },
        },
      ]);
    });
  });

  it('records the guard’s permission denial with the permission that was reached for', async () => {
    await withRollback(prisma, async (tx) => {
      const { context, rows } = await world(tx);

      await testRecorder(tx).refused(
        context,
        new AuthorizationError(
          'PERMISSION_DENIED',
          'Your role cannot perform this action',
        ),
        { detail: { permission: 'staff.changeRole' } },
      );

      expect(await rows()).toMatchObject([
        {
          kind: 'PERMISSION_DENIED',
          code: 'PERMISSION_DENIED',
          status: 403,
          // No id on the route, so no half-recorded reference either.
          targetTable: null,
          targetId: null,
          detail: { permission: 'staff.changeRole' },
        },
      ]);
    });
  });

  it('records the settings locks and the two administration 404s', async () => {
    await withRollback(prisma, async (tx) => {
      const { context, rows } = await world(tx);
      const recorder = testRecorder(tx);

      await recorder.refused(
        context,
        new DomainError('SETTING_IMMUTABLE', 'The time zone cannot change.'),
        { id: 'business.timezone' },
      );
      await recorder.refused(
        context,
        new DomainError(
          'SETTING_LOCKED_BY_HISTORY',
          'The business already has accounts.',
        ),
        { id: 'business.currency' },
      );
      await recorder.refused(
        context,
        new NotFoundError('STAFF_NOT_FOUND', 'Staff not found'),
        { id: 'sp_guessed' },
      );

      expect(await rows()).toMatchObject([
        { kind: 'SETTING_LOCKED', targetTable: 'setting', status: 422 },
        { kind: 'SETTING_LOCKED', targetId: 'business.currency' },
        {
          kind: 'OUT_OF_SCOPE',
          code: 'STAFF_NOT_FOUND',
          status: 404,
          targetTable: 'staff_profile',
        },
      ]);
    });
  });

  it('keeps the routine out: a conflict, a plain Error and an infrastructure failure are not attempts', async () => {
    await withRollback(prisma, async (tx) => {
      const { context, rows } = await world(tx);
      const recorder = testRecorder(tx);

      await recorder.refused(
        context,
        new ConflictError('EMAIL_TAKEN', 'That email already has an account.'),
      );
      await recorder.refused(
        context,
        new NotFoundError('CUSTOMER_NOT_FOUND', 'Customer not found'),
      );
      await recorder.refused(context, new Error('something broke'));
      await recorder.refused(
        context,
        new InternalError('PERMISSION_DENIED', 'not a refusal'),
      );

      expect(await rows()).toEqual([]);
    });
  });

  it('a record that cannot be written changes nothing the caller sees, and is logged not thrown', async () => {
    await withRollback(prisma, async (tx) => {
      const { context, rows } = await world(tx);
      const log = recorderLog();
      const denied = new AuthorizationError(
        'ROLE_ABOVE_OWN',
        'An Admin cannot give someone the Super Admin role.',
      );

      // The call the service makes on its way to rethrowing `denied`.
      await expect(
        failingRecorder(tx, log).refused(context, denied, { id: 'sp_1' }),
      ).resolves.toBeUndefined();

      expect(log.errored).toMatchObject([
        { fields: { code: 'ROLE_ABOVE_OWN' } },
      ]);
      expect(await rows()).toEqual([]);
      // Untouched: the same object, the same code, the same status.
      expect(denied).toMatchObject({ code: 'ROLE_ABOVE_OWN', status: 403 });
    });
  });

  it('says so rather than writing an unattributable row when no route matched', async () => {
    await withRollback(prisma, async (tx) => {
      const { context, rows } = await world(tx);
      const log = recorderLog();

      await testRecorder(tx, { logger: log, route: null }).refused(
        context,
        new AuthorizationError('PERMISSION_DENIED', 'no'),
      );

      expect(log.warned).toMatchObject([
        { message: 'security event not recorded: no route in context' },
      ]);
      expect(await rows()).toEqual([]);
    });
  });
});
