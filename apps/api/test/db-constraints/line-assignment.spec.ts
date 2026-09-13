import type { PrismaClient } from '@repo/db';

import { createTestPrismaClient } from '../database.js';
import { withRollback } from '../with-rollback.js';
import { createLine, createStaff } from './fixtures.js';

/**
 * Temporal staffing invariants (M03, BR-15), migration
 * `constraints_line_assignment`.
 */
describe('line_assignment constraints (M03)', () => {
  let prisma: PrismaClient;

  beforeAll(() => {
    prisma = createTestPrismaClient();
  });

  // Every case runs inside withRollback, so nothing reaches the shared schema.
  afterAll(async () => {
    await prisma.$disconnect();
  });

  type Assignment = {
    lineId: string;
    staffProfileId: string;
    assignmentRole: 'SENIOR' | 'JUNIOR';
    effectiveFrom?: Date;
    effectiveTo?: Date | null;
  };

  const assign = (tx: PrismaClient, a: Assignment) =>
    tx.lineAssignment.create({
      data: { effectiveFrom: new Date('2026-09-01'), effectiveTo: null, ...a },
    });

  it('rejects a second current Senior on the same line', async () => {
    await expect(
      withRollback(prisma, async (tx) => {
        const { organization, line } = await createLine(tx);
        const first = await createStaff(tx, organization.id, 'SENIOR');
        const second = await createStaff(tx, organization.id, 'SENIOR');
        await assign(tx, {
          lineId: line.id,
          staffProfileId: first.id,
          assignmentRole: 'SENIOR',
        });
        await assign(tx, {
          lineId: line.id,
          staffProfileId: second.id,
          assignmentRole: 'SENIOR',
        });
      }),
    ).rejects.toThrow(
      /Unique constraint failed on the (fields: \(`lineId`\)|constraint: `line_assignment_current_senior_key`)/,
    );
  });

  it('accepts a new Senior once the previous assignment has ended', async () => {
    await expect(
      withRollback(prisma, async (tx) => {
        const { organization, line } = await createLine(tx);
        const first = await createStaff(tx, organization.id, 'SENIOR');
        const second = await createStaff(tx, organization.id, 'SENIOR');
        await assign(tx, {
          lineId: line.id,
          staffProfileId: first.id,
          assignmentRole: 'SENIOR',
          effectiveTo: new Date('2026-09-10'),
        });
        await assign(tx, {
          lineId: line.id,
          staffProfileId: second.id,
          assignmentRole: 'SENIOR',
          effectiveFrom: new Date('2026-09-11'),
        });
      }),
    ).resolves.toBeUndefined();
  });

  it('accepts several current Juniors on one line', async () => {
    await expect(
      withRollback(prisma, async (tx) => {
        const { organization, line } = await createLine(tx);
        for (let i = 0; i < 3; i++) {
          const junior = await createStaff(tx, organization.id, 'JUNIOR');
          await assign(tx, {
            lineId: line.id,
            staffProfileId: junior.id,
            assignmentRole: 'JUNIOR',
          });
        }
      }),
    ).resolves.toBeUndefined();
  });

  it('rejects a staff member holding two current lines at once', async () => {
    await expect(
      withRollback(prisma, async (tx) => {
        const a = await createLine(tx);
        const b = await createLine(tx);
        const junior = await createStaff(tx, a.organization.id, 'JUNIOR');
        await assign(tx, {
          lineId: a.line.id,
          staffProfileId: junior.id,
          assignmentRole: 'JUNIOR',
        });
        await assign(tx, {
          lineId: b.line.id,
          staffProfileId: junior.id,
          assignmentRole: 'JUNIOR',
        });
      }),
    ).rejects.toThrow(
      /Unique constraint failed on the (fields: \(`staffProfileId`\)|constraint: `line_assignment_current_staff_key`)/,
    );
  });

  it('rejects an assignment that ends before it starts', async () => {
    await expect(
      withRollback(prisma, async (tx) => {
        const { organization, line } = await createLine(tx);
        const junior = await createStaff(tx, organization.id, 'JUNIOR');
        await assign(tx, {
          lineId: line.id,
          staffProfileId: junior.id,
          assignmentRole: 'JUNIOR',
          effectiveFrom: new Date('2026-09-10'),
          effectiveTo: new Date('2026-09-09'),
        });
      }),
    ).rejects.toThrow('line_assignment_effective_range_check');
  });
});
