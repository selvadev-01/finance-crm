import type { INestApplication } from '@nestjs/common';
import type { PrismaClient, StaffRole, StaffStatus } from '@repo/db';
import { randomInt } from 'node:crypto';
import type { Server } from 'node:http';
import request from 'supertest';

import { auth } from '../src/auth/auth.config.js';
import { testCode, testEmail } from './database.js';

export const TEST_PASSWORD = 'a-sufficiently-long-password';

export interface TestStaff {
  email: string;
  password: string;
  userId: string;
  /** Empty when created without a staff profile. */
  staffProfileId: string;
}

/**
 * A Better Auth user with a password credential, and optionally a staff
 * profile — created server-side, the way Admin staff creation (US-092) will,
 * because public sign-up is disabled (M01). Run-tagged for cleanup.
 */
export async function createTestStaff(
  prisma: PrismaClient,
  options: {
    organizationId: string;
    role: StaffRole | null;
    status?: StaffStatus;
    label?: string;
  },
): Promise<TestStaff> {
  const context = await auth.$context;
  const email = testEmail(
    options.label ?? options.role?.toLowerCase() ?? 'user',
  );
  const user = await context.internalAdapter.createUser(
    {
      email,
      name: 'Test Staff',
      emailVerified: true,
    },
    // Created by an administrator, as US-092 staff creation will be.
    { method: 'admin' },
  );
  await context.internalAdapter.linkAccount({
    userId: user.id,
    providerId: 'credential',
    accountId: user.id,
    password: await context.password.hash(TEST_PASSWORD),
  });

  if (options.role === null) {
    return {
      email,
      password: TEST_PASSWORD,
      userId: user.id,
      staffProfileId: '',
    };
  }
  const staff = await prisma.staffProfile.create({
    data: {
      organizationId: options.organizationId,
      userId: user.id,
      staffCode: testCode('ST'),
      role: options.role,
      status: options.status ?? 'ACTIVE',
      phone: `+91${randomInt(1_000_000_000, 9_999_999_999)}`,
      joinedAt: new Date('2026-01-01'),
    },
  });
  return {
    email,
    password: TEST_PASSWORD,
    userId: user.id,
    staffProfileId: staff.id,
  };
}

/** Signs in over HTTP and returns the session cookie. */
export async function signIn(
  app: INestApplication<Server>,
  staff: Pick<TestStaff, 'email' | 'password'>,
): Promise<string> {
  const response = await request(app.getHttpServer())
    .post('/api/auth/sign-in/email')
    .send({ email: staff.email, password: staff.password })
    .expect(200);
  return String(response.headers['set-cookie']);
}

/** An organization, sector and lines, all run-tagged. */
export async function createTestOrganization(
  prisma: PrismaClient,
  lineNames: string[] = [],
) {
  const organization = await prisma.organization.create({
    data: { name: testCode('ORG'), timezone: 'Asia/Kolkata', currency: 'INR' },
  });
  const sector = await prisma.sector.create({
    data: {
      organizationId: organization.id,
      code: testCode('SEC'),
      name: 'Sector',
    },
  });
  const lines = [];
  for (const name of lineNames) {
    lines.push(
      await prisma.line.create({
        data: {
          organizationId: organization.id,
          sectorId: sector.id,
          code: testCode('LN'),
          name,
        },
      }),
    );
  }
  return { organization, sector, lines };
}
