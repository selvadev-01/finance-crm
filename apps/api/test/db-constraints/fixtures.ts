import { Prisma, type PrismaClient } from '@repo/db';
import { openLinePeriod } from '../database.js';
import { randomUUID } from 'node:crypto';

/**
 * Minimal valid parent rows for the database-constraint specs.
 *
 * Every helper takes the transaction-bound client from `withRollback`, so the
 * rows exist only inside the test's transaction. Identifying values carry a
 * random suffix so they never collide with development data in `public`.
 */

export const decimal = (value: string) => new Prisma.Decimal(value);

export async function createUser(tx: PrismaClient) {
  const id = randomUUID();
  return tx.user.create({
    data: {
      id,
      name: 'Constraint Probe',
      email: `${id}@constraints.rasi.test`,
    },
  });
}

export async function createLine(tx: PrismaClient) {
  const suffix = randomUUID();
  const organization = await tx.organization.create({
    data: { name: 'Rasi Test', timezone: 'Asia/Kolkata', currency: 'INR' },
  });
  const sector = await tx.sector.create({
    data: {
      organizationId: organization.id,
      code: `S-${suffix}`,
      name: 'Sector',
    },
  });
  const line = await tx.line.create({
    data: {
      organizationId: organization.id,
      sectorId: sector.id,
      code: `L-${suffix}`,
      name: 'Line',
    },
  });
  return { organization, sector, line };
}

export async function createStaff(
  tx: PrismaClient,
  organizationId: string,
  role: 'ADMIN' | 'SENIOR' | 'JUNIOR',
) {
  const user = await createUser(tx);
  const suffix = randomUUID();
  return tx.staffProfile.create({
    data: {
      organizationId,
      userId: user.id,
      staffCode: `ST-${suffix}`,
      role,
      phone: `+91${suffix}`,
      joinedAt: new Date('2026-01-01'),
    },
  });
}

/** An ACTIVE account on the PDF reference figures: A 10,000 / I 8,500 / D 100. */
export async function createActiveAccount(tx: PrismaClient) {
  const { organization, sector, line } = await createLine(tx);
  const suffix = randomUUID();
  const customer = await tx.customer.create({
    data: {
      organizationId: organization.id,
      customerCode: `C-${suffix}`,
      name: 'Customer',
      mobile: '+919800000000',
      address: 'Address',
      sectorId: sector.id,
      lineId: line.id,
      linePeriods: openLinePeriod(line.id),
    },
  });
  const account = await tx.accountLoan.create({
    data: {
      organizationId: organization.id,
      accountCode: `A-${suffix}`,
      customerId: customer.id,
      lineId: line.id,
      accountAmount: decimal('10000.00'),
      investedAmount: decimal('8500.00'),
      profitAmount: decimal('1500.00'),
      dailyAmount: decimal('100.00'),
      termDays: 100,
      outstandingAmount: decimal('10000.00'),
      disbursementDate: new Date('2026-09-01'),
      firstCollectionDate: new Date('2026-09-02'),
      targetCompletionDate: new Date('2026-12-10'),
      status: 'ACTIVE',
    },
  });
  return { organization, sector, line, customer, account };
}
