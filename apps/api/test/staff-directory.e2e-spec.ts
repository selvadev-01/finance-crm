import type { INestApplication } from '@nestjs/common';
import type { PrismaClient, StaffRole } from '@repo/db';
import { toBusinessDate } from '@repo/domain';
import type { Server } from 'node:http';
import request from 'supertest';

import { createTestApp } from './app.js';
import { createTestPrismaClient, deleteTestRunData } from './database.js';
import {
  createTestOrganization,
  createTestStaff,
  signIn,
  type TestStaff,
} from './staff.js';

interface Row {
  staffProfileId: string;
  status: string;
  currentAssignment: { lineId: string; lineName: string } | null;
}

/**
 * The Team read model over HTTP (S-14): who each role may list, the line each
 * person works today, and the history a detail page may show.
 */
describe('staff directory (S-14, e2e)', () => {
  let app: INestApplication<Server>;
  let prisma: PrismaClient;
  let lineA: string;
  let lineB: string;
  const cookies: Record<string, string> = {};
  const staff: Record<string, TestStaff> = {};
  const today = toBusinessDate(new Date());
  const tomorrow = new Date(Date.parse(`${today}T00:00:00Z`) + 86_400_000);

  const as = (who: string) => ({
    get: (path: string) =>
      request(app.getHttpServer()).get(path).set('Cookie', cookies[who]!),
  });
  const ids = (body: { data: Row[] }) =>
    body.data.map((row) => row.staffProfileId);

  async function assign(
    who: string,
    lineId: string,
    role: 'SENIOR' | 'JUNIOR',
    from: Date | string,
    to: string | null = null,
  ) {
    await prisma.lineAssignment.create({
      data: {
        staffProfileId: staff[who]!.staffProfileId,
        lineId,
        assignmentRole: role,
        effectiveFrom: typeof from === 'string' ? new Date(from) : from,
        effectiveTo: to ? new Date(to) : null,
      },
    });
  }

  beforeAll(async () => {
    prisma = createTestPrismaClient();
    app = await createTestApp();
    const org = await createTestOrganization(prisma, ['Line A', 'Line B']);
    const organizationId = org.organization.id;
    lineA = org.lines[0]!.id;
    lineB = org.lines[1]!.id;

    const people: [string, StaffRole, 'ACTIVE' | 'SUSPENDED'][] = [
      ['superAdmin', 'SUPER_ADMIN', 'ACTIVE'],
      ['admin', 'ADMIN', 'ACTIVE'],
      ['seniorA', 'SENIOR', 'ACTIVE'],
      ['seniorB', 'SENIOR', 'ACTIVE'],
      ['juniorA', 'JUNIOR', 'ACTIVE'],
      ['moved', 'JUNIOR', 'ACTIVE'],
      ['upcoming', 'JUNIOR', 'ACTIVE'],
      ['suspended', 'JUNIOR', 'SUSPENDED'],
      ['deleted', 'JUNIOR', 'ACTIVE'],
    ];
    for (const [who, role, status] of people) {
      staff[who] = await createTestStaff(prisma, {
        organizationId,
        role,
        status,
        label: who,
      });
    }
    for (const who of [
      'superAdmin',
      'admin',
      'seniorA',
      'seniorB',
      'juniorA',
    ]) {
      cookies[who] = await signIn(app, staff[who]!);
    }

    await assign('seniorA', lineA, 'SENIOR', '2026-01-01');
    await assign('seniorB', lineB, 'SENIOR', '2026-01-01');
    await assign('juniorA', lineA, 'JUNIOR', '2026-01-01');
    // Worked Line A, then moved to Line B.
    await assign('moved', lineA, 'JUNIOR', '2026-01-01', '2026-03-31');
    await assign('moved', lineB, 'JUNIOR', '2026-04-01');
    // Joins Line A tomorrow: not on it yet.
    await assign('upcoming', lineA, 'JUNIOR', tomorrow);
    await assign('suspended', lineA, 'JUNIOR', '2026-01-01');
    await assign('deleted', lineA, 'JUNIOR', '2026-01-01', '2026-02-01');
    await prisma.staffProfile.update({
      where: { id: staff.deleted!.staffProfileId },
      data: { deletedAt: new Date() },
    });

    // Someone in another organization, who must never appear.
    const elsewhere = await createTestOrganization(prisma);
    staff.outsider = await createTestStaff(prisma, {
      organizationId: elsewhere.organization.id,
      role: 'JUNIOR',
      label: 'outsider',
    });
  });

  afterAll(async () => {
    await app.close();
    await deleteTestRunData(prisma);
    await prisma.$disconnect();
  });

  it('an Admin lists their organization with the line each person works today, and nobody soft-deleted or elsewhere', async () => {
    const response = await as('admin').get('/api/staff?limit=200').expect(200);
    const listed = ids(response.body);

    for (const who of [
      'superAdmin',
      'admin',
      'seniorA',
      'seniorB',
      'juniorA',
      'moved',
      'upcoming',
      'suspended',
    ]) {
      expect(listed).toContain(staff[who]!.staffProfileId);
    }
    expect(listed).not.toContain(staff.deleted!.staffProfileId);
    expect(listed).not.toContain(staff.outsider!.staffProfileId);

    const byId = new Map<string, Row>(
      response.body.data.map((row: Row) => [row.staffProfileId, row]),
    );
    expect(
      byId.get(staff.moved!.staffProfileId)!.currentAssignment,
    ).toMatchObject({ lineId: lineB, lineName: 'Line B' });
    expect(
      byId.get(staff.upcoming!.staffProfileId)!.currentAssignment,
    ).toBeNull();
    expect(byId.get(staff.suspended!.staffProfileId)!.status).toBe('SUSPENDED');
  });

  it('filters by role and status', async () => {
    const juniors = await as('superAdmin')
      .get('/api/staff?limit=200&role=JUNIOR&status=ACTIVE')
      .expect(200);
    expect(ids(juniors.body).sort()).toEqual(
      ['juniorA', 'moved', 'upcoming']
        .map((w) => staff[w]!.staffProfileId)
        .sort(),
    );
    await as('admin').get('/api/staff?role=OWNER').expect(400);
  });

  it('a Senior lists only the staff on their own line today', async () => {
    const response = await as('seniorA')
      .get('/api/staff?limit=200')
      .expect(200);
    expect(ids(response.body).sort()).toEqual(
      ['seniorA', 'juniorA', 'suspended']
        .map((w) => staff[w]!.staffProfileId)
        .sort(),
    );
  });

  it('a Junior is refused the Team list', async () => {
    const response = await as('juniorA').get('/api/staff').expect(403);
    expect(response.body.code).toBe('PERMISSION_DENIED');
  });

  it('an Admin sees a person’s whole history, newest first, with a scheduled move marked upcoming', async () => {
    const moved = await as('admin')
      .get(`/api/staff/${staff.moved!.staffProfileId}`)
      .expect(200);
    expect(
      moved.body.assignments.map((a: { lineId: string }) => a.lineId),
    ).toEqual([lineB, lineA]);
    expect(moved.body.assignments[1]).toMatchObject({
      effectiveFrom: '2026-01-01',
      effectiveTo: '2026-03-31',
      upcoming: false,
    });

    const upcoming = await as('admin')
      .get(`/api/staff/${staff.upcoming!.staffProfileId}`)
      .expect(200);
    expect(upcoming.body.currentAssignment).toBeNull();
    expect(upcoming.body.assignments).toEqual([
      expect.objectContaining({ lineId: lineA, upcoming: true }),
    ]);
  });

  it('a Senior sees only their own line’s rows of a person’s history', async () => {
    const response = await as('seniorB')
      .get(`/api/staff/${staff.moved!.staffProfileId}`)
      .expect(200);
    expect(
      response.body.assignments.map((a: { lineId: string }) => a.lineId),
    ).toEqual([lineB]);
  });

  it('someone off the Senior’s line, soft-deleted, or in another organization is 404, identical to a missing id', async () => {
    const missing = await as('admin')
      .get('/api/staff/does-not-exist')
      .expect(404);
    const cases: [string, string][] = [
      ['seniorA', staff.moved!.staffProfileId],
      ['seniorA', staff.upcoming!.staffProfileId],
      ['admin', staff.deleted!.staffProfileId],
      ['admin', staff.outsider!.staffProfileId],
    ];
    for (const [who, id] of cases) {
      const response = await as(who).get(`/api/staff/${id}`).expect(404);
      expect(response.body.code).toBe(missing.body.code);
      expect(response.body.message).toBe(missing.body.message);
    }
  });

  /** The team half of the console's global search (US-024a). */
  describe('searching staff (US-024a)', () => {
    const search = async (who: string, q: string) =>
      ids(
        (
          await as(who)
            .get(`/api/staff?limit=200&q=${encodeURIComponent(q)}`)
            .expect(200)
        ).body,
      );

    /**
     * A tagged test address is about 95 characters — past the 80 the contract
     * allows, as a real one never would be. The local part is unique to this
     * run and well inside the cap, so it is what these tests search on.
     */
    const emailFragment = (email: string) => email.split('@')[0]!;

    it('finds a person by part of the staff code, the email, the phone or the name, in any case', async () => {
      const target = staff.juniorA!;
      const profile = await prisma.staffProfile.findUniqueOrThrow({
        where: { id: target.staffProfileId },
        select: { staffCode: true, phone: true },
      });
      // A staff code carries a random suffix, so nothing here is an exact
      // match — the fragments below are each unique to this run.
      for (const q of [
        profile.staffCode,
        profile.staffCode.toUpperCase(),
        profile.staffCode.slice(-8),
        emailFragment(target.email),
        emailFragment(target.email).toUpperCase(),
        profile.phone!.slice(-6),
      ]) {
        expect(await search('admin', q), q).toContain(target.staffProfileId);
      }
      // The name every test person shares still matches this one among them.
      expect(await search('admin', 'test staff')).toContain(
        target.staffProfileId,
      );
    });

    it('a fragment matching nobody finds nobody, rather than the whole team', async () => {
      expect(await search('admin', 'ST-no-such-run-tag')).toEqual([]);
    });

    it('search stays within scope: a Senior never finds staff off their line, and nobody finds another organization’s', async () => {
      const offLine = await prisma.staffProfile.findUniqueOrThrow({
        where: { id: staff.seniorB!.staffProfileId },
        select: { staffCode: true },
      });
      expect(await search('seniorA', offLine.staffCode)).not.toContain(
        staff.seniorB!.staffProfileId,
      );
      expect(
        await search('seniorA', emailFragment(staff.seniorB!.email)),
      ).not.toContain(staff.seniorB!.staffProfileId);
      // The Senior's own line is still searchable.
      expect(
        await search('seniorA', emailFragment(staff.juniorA!.email)),
      ).toContain(staff.juniorA!.staffProfileId);

      const outsider = await prisma.staffProfile.findUniqueOrThrow({
        where: { id: staff.outsider!.staffProfileId },
        select: { staffCode: true },
      });
      expect(await search('admin', outsider.staffCode)).toEqual([]);
    });

    it('a soft-deleted person is not found, by any of the fields', async () => {
      const gone = await prisma.staffProfile.findUniqueOrThrow({
        where: { id: staff.deleted!.staffProfileId },
        select: { staffCode: true },
      });
      expect(await search('admin', gone.staffCode)).toEqual([]);
      expect(
        await search('admin', emailFragment(staff.deleted!.email)),
      ).toEqual([]);
    });

    it('an over-long search is refused naming the field', async () => {
      const response = await as('admin')
        .get(`/api/staff?q=${'a'.repeat(81)}`)
        .expect(400);
      expect(response.body.details).toEqual(
        expect.arrayContaining([expect.objectContaining({ field: 'q' })]),
      );
    });
  });
});
