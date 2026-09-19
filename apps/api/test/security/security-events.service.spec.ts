import type { Prisma, PrismaClient } from '@repo/db';
import { randomUUID } from 'node:crypto';

import type { RequestContext } from '../../src/platform/context/request-context.js';
import { Database } from '../../src/platform/database/database.js';
import { SecurityEventsService } from '../../src/security/security-events.service.js';
import { createTestPrismaClient } from '../database.js';
import { createLine, createStaff } from '../db-constraints/fixtures.js';
import { withRollback } from '../with-rollback.js';

/**
 * The security log (ADR-0014) — reading the security log. Scope first: the log names people, so an
 * Admin must never see another business's attempts, and "count only the rows
 * this test created" is not a nicety here — the shared schema holds whatever
 * development has produced.
 */
describe('SecurityEventsService (ADR-0014)', () => {
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
    const other = await createStaff(tx, organization.id, 'SENIOR');
    const context: RequestContext = {
      requestId: `req_${randomUUID()}`,
      userId: actor.userId,
      staffProfileId: actor.id,
      organizationId: organization.id,
      role: 'ADMIN',
      currentLineId: null,
    };
    const service = new SecurityEventsService(new Database(tx));

    const write = (
      data: Partial<Prisma.SecurityEventUncheckedCreateInput> = {},
    ) =>
      tx.securityEvent.create({
        data: {
          organizationId: organization.id,
          actorUserId: actor.userId,
          actorRole: 'ADMIN',
          kind: 'RANK_GUARD',
          code: 'ROLE_ABOVE_OWN',
          status: 403,
          method: 'POST',
          path: '/api/staff',
          ...data,
        },
      });

    return { context, organization, actor, other, service, write };
  }

  it('lists the organization’s attempts newest first, with the actor’s name and role', async () => {
    await withRollback(prisma, async (tx) => {
      const { context, actor, service, write } = await world(tx);
      await write({ createdAt: new Date('2026-09-18T04:00:00Z') });
      await write({
        code: 'PERMISSION_DENIED',
        kind: 'PERMISSION_DENIED',
        createdAt: new Date('2026-09-18T05:00:00Z'),
        detail: { permission: 'staff.changeRole' },
      });

      const page = await service.list(context, { limit: 50 });

      expect(page.data.map((row) => row.code)).toEqual([
        'PERMISSION_DENIED',
        'ROLE_ABOVE_OWN',
      ]);
      expect(page.data[0]).toMatchObject({
        actor: {
          userId: actor.userId,
          name: 'Constraint Probe',
          role: 'ADMIN',
        },
        detail: { permission: 'staff.changeRole' },
        status: 403,
        path: '/api/staff',
      });
      expect(page.hasMore).toBe(false);
    });
  });

  it('never shows another business’s attempts', async () => {
    await withRollback(prisma, async (tx) => {
      const mine = await world(tx);
      const theirs = await world(tx);
      await mine.write({ code: 'CANNOT_CHANGE_OWN_ROLE', kind: 'SELF_GUARD' });
      await theirs.write({ code: 'SETTING_IMMUTABLE', kind: 'SETTING_LOCKED' });

      const page = await mine.service.list(mine.context, { limit: 50 });

      expect(page.data.map((row) => row.code)).toEqual([
        'CANNOT_CHANGE_OWN_ROLE',
      ]);
    });
  });

  it('filters by staff member, kind, code and business-date range', async () => {
    await withRollback(prisma, async (tx) => {
      const { context, actor, other, service, write } = await world(tx);
      await write({ createdAt: new Date('2026-09-10T04:00:00Z') });
      await write({
        actorUserId: other.userId,
        actorRole: 'SENIOR',
        kind: 'PERMISSION_DENIED',
        code: 'PERMISSION_DENIED',
        createdAt: new Date('2026-09-15T04:00:00Z'),
      });

      const codes = async (query: Record<string, unknown>) =>
        (
          await service.list(context, {
            limit: 50,
            ...query,
          } as Parameters<typeof service.list>[1])
        ).data.map((row) => row.code);

      expect(await codes({ actorUserId: other.userId })).toEqual([
        'PERMISSION_DENIED',
      ]);
      expect(await codes({ actorUserId: actor.userId })).toEqual([
        'ROLE_ABOVE_OWN',
      ]);
      expect(await codes({ kind: 'PERMISSION_DENIED' })).toEqual([
        'PERMISSION_DENIED',
      ]);
      expect(await codes({ code: 'ROLE_ABOVE_OWN' })).toEqual([
        'ROLE_ABOVE_OWN',
      ]);
      // Inclusive on both ends, in the business time zone (BR-12).
      expect(await codes({ from: '2026-09-15', to: '2026-09-15' })).toEqual([
        'PERMISSION_DENIED',
      ]);
      expect(await codes({ from: '2026-09-10', to: '2026-09-15' })).toEqual([
        'PERMISSION_DENIED',
        'ROLE_ABOVE_OWN',
      ]);
    });
  });

  it('refuses a reversed date range, and pages with a cursor', async () => {
    await withRollback(prisma, async (tx) => {
      const { context, service, write } = await world(tx);
      for (let index = 0; index < 3; index += 1) {
        await write({
          code: `CODE_${index}`,
          createdAt: new Date(`2026-09-1${index + 1}T04:00:00Z`),
        });
      }

      await expect(
        service.list(context, {
          limit: 50,
          from: '2026-09-16',
          to: '2026-09-15',
        }),
      ).rejects.toMatchObject({ code: 'INVALID_DATE_RANGE', status: 400 });

      const first = await service.list(context, { limit: 2 });
      expect(first.hasMore).toBe(true);
      const second = await service.list(context, {
        limit: 2,
        cursor: first.nextCursor!,
      });
      expect(second.data.map((row) => row.code)).toEqual(['CODE_0']);
      expect(second.hasMore).toBe(false);
    });
  });
});
