import type { PrismaClient } from '@repo/db';
import type { SignUpRequest } from '@repo/contracts';
import { randomInt, randomUUID } from 'node:crypto';

import { AuditWriter } from '../../src/audit/audit.writer.js';
import { EmailOutbox } from '../../src/email/email-outbox.js';
import type { AppConfig } from '../../src/platform/config/config.js';
import { OrganizationSignUpService } from '../../src/identity/organization-sign-up.service.js';
import { PasswordHasher } from '../../src/identity/password-hasher.js';
import { SignUpRateLimiter } from '../../src/identity/sign-up-rate-limiter.js';
import { Database } from '../../src/platform/database/database.js';
import { createTestPrismaClient } from '../database.js';
import { withRollback } from '../with-rollback.js';

/**
 * Organization sign-up (US-006, ADR-0012) against real rows, rolled back — so
 * the organization, slug, credential, staff profile and audit rows can be
 * inspected. Refusals are checked before any write, so none aborts the test
 * transaction.
 */
describe('OrganizationSignUpService (US-006)', () => {
  let prisma: PrismaClient;
  const hasher = new PasswordHasher();

  beforeAll(() => {
    prisma = createTestPrismaClient();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  function service(
    tx: PrismaClient,
    limiter = new SignUpRateLimiter({ limit: 100, windowMs: 60_000 }),
    email: AppConfig['EMAIL_PROVIDER'] = 'NONE',
  ) {
    const database = new Database(tx);
    return new OrganizationSignUpService(
      database,
      new AuditWriter(database),
      hasher,
      limiter,
      new EmailOutbox(database, {
        EMAIL_PROVIDER: email,
        WEB_ORIGIN: 'https://rasi.example',
      } as AppConfig),
    );
  }

  /** A name no other organization in the shared schema can already slug to. */
  const uniqueName = (label = 'Lakshmi Finance') =>
    `${label} ${randomUUID().slice(0, 8)}`;

  function request(overrides: Partial<SignUpRequest> = {}): SignUpRequest {
    return {
      organizationName: uniqueName(),
      name: 'Lakshmi Owner',
      email: `owner-${randomUUID()}@sign-up.rasi.test`,
      phone: `+919${randomInt(100_000_000, 999_999_999)}`,
      password: 'the-owners-own-password',
      ...overrides,
    };
  }

  it('creates the organization and its owner as an active Super Admin who can sign in', async () => {
    await withRollback(prisma, async (tx) => {
      const input = request();

      const result = await service(tx).signUp(input);

      const organization = await tx.organization.findUniqueOrThrow({
        where: { id: result.organizationId },
      });
      expect(organization).toMatchObject({
        name: input.organizationName,
        slug: result.slug,
        timezone: 'Asia/Kolkata',
        currency: 'INR',
      });
      const staff = await tx.staffProfile.findUniqueOrThrow({
        where: { id: result.staffProfileId },
        include: { user: true },
      });
      expect(staff).toMatchObject({
        organizationId: organization.id,
        role: 'SUPER_ADMIN',
        status: 'ACTIVE',
        phone: input.phone,
        mustChangePassword: false,
        user: { email: input.email, name: 'Lakshmi Owner' },
      });
      const credential = await tx.account.findFirstOrThrow({
        where: { userId: staff.userId, providerId: 'credential' },
      });
      expect(await hasher.verify(credential.password!, input.password)).toBe(
        true,
      );
    });
  });

  it('generates the slug from the business name', async () => {
    await withRollback(prisma, async (tx) => {
      const suffix = randomUUID().slice(0, 8);
      const { slug } = await service(tx).signUp(
        request({ organizationName: `Śrī Lakshmi Finance & Co. ${suffix}` }),
      );
      expect(slug).toBe(`sri-lakshmi-finance-co-${suffix}`);
    });
  });

  it('numbers the slug when another organization already has it', async () => {
    await withRollback(prisma, async (tx) => {
      const name = uniqueName('Ganesh Chits');
      const first = await service(tx).signUp(
        request({ organizationName: name }),
      );
      const second = await service(tx).signUp(
        request({ organizationName: name }),
      );
      const third = await service(tx).signUp(
        request({ organizationName: name.toUpperCase() }),
      );

      expect(second.slug).toBe(`${first.slug}-2`);
      expect(third.slug).toBe(`${first.slug}-3`);
    });
  });

  it('gives a name with no Latin letters a random org- slug', async () => {
    await withRollback(prisma, async (tx) => {
      const { slug } = await service(tx).signUp(
        request({ organizationName: 'லட்சுமி நிதி' }),
      );
      expect(slug).toMatch(/^org-[0-9a-f]{8}$/);
    });
  });

  it('finds an organization by its slug, and 404s an unknown one', async () => {
    await withRollback(prisma, async (tx) => {
      const input = request();
      const { slug } = await service(tx).signUp(input);

      await expect(service(tx).findBySlug(slug)).resolves.toEqual({
        slug,
        name: input.organizationName,
      });
      await expect(
        service(tx).findBySlug(`no-such-business-${randomUUID()}`),
      ).rejects.toMatchObject({ code: 'ORGANIZATION_NOT_FOUND', status: 404 });
    });
  });

  it('audits the organization and the owner, with the owner as actor and no password', async () => {
    await withRollback(prisma, async (tx) => {
      const input = request();
      const { organizationId, staffProfileId, slug } =
        await service(tx).signUp(input);

      const rows = await tx.auditLog.findMany({
        where: { organizationId },
        orderBy: { entityTable: 'asc' },
      });
      const owner = await tx.staffProfile.findUniqueOrThrow({
        where: { id: staffProfileId },
      });
      expect(rows).toEqual([
        expect.objectContaining({
          action: 'CREATE',
          entityTable: 'organization',
          entityId: organizationId,
          actorUserId: owner.userId,
          after: { name: input.organizationName, slug, signUp: true },
        }),
        expect.objectContaining({
          action: 'CREATE',
          entityTable: 'staff_profile',
          entityId: staffProfileId,
          actorUserId: owner.userId,
          after: { role: 'SUPER_ADMIN', staffCode: owner.staffCode },
        }),
      ]);
      expect(JSON.stringify(rows)).not.toContain(input.password);
    });
  });

  it('queues a welcome email with the sign-in link when email is configured, and none otherwise', async () => {
    await withRollback(prisma, async (tx) => {
      const limiter = new SignUpRateLimiter({ limit: 100, windowMs: 60_000 });
      const input = request({ name: 'Lakshmi <Owner>' });
      const { organizationId, slug } = await service(
        tx,
        limiter,
        'SMTP',
      ).signUp(input);

      const email = await tx.emailOutbox.findFirstOrThrow({
        where: { organizationId },
      });
      expect(email).toMatchObject({
        kind: 'WELCOME',
        notificationId: null,
        status: 'PENDING',
        subject: `Welcome to Rasi — ${input.organizationName}`,
      });
      expect(email.textBody).toContain(
        `https://rasi.example/${slug}/sign-in`,
      );
      // A name is user input: escaped in the HTML part.
      expect(email.htmlBody).toContain('Lakshmi &lt;Owner&gt;');
      expect(email.htmlBody).not.toContain('<Owner>');
      expect(JSON.stringify(email)).not.toContain(input.password);

      const quiet = await service(tx).signUp(request());
      expect(
        await tx.emailOutbox.count({
          where: { organizationId: quiet.organizationId },
        }),
      ).toBe(0);
    });
  });

  it('refuses once the address has used its attempts (429), and writes nothing', async () => {
    await withRollback(prisma, async (tx) => {
      const limiter = new SignUpRateLimiter({ limit: 1, windowMs: 60_000 });
      await service(tx, limiter).signUp(request());

      const input = request();
      await expect(service(tx, limiter).signUp(input)).rejects.toMatchObject({
        code: 'SIGN_UP_RATE_LIMITED',
        status: 429,
      });
      expect(await tx.user.count({ where: { email: input.email } })).toBe(0);
    });
  });

  it('refuses an email that already has an account (409 EMAIL_TAKEN)', async () => {
    await withRollback(prisma, async (tx) => {
      const first = request();
      await service(tx).signUp(first);

      await expect(
        service(tx).signUp(request({ email: first.email })),
      ).rejects.toMatchObject({ code: 'EMAIL_TAKEN', status: 409 });
    });
  });

  it('refuses a mobile number already on a staff member (409 PHONE_TAKEN)', async () => {
    await withRollback(prisma, async (tx) => {
      const first = request();
      await service(tx).signUp(first);

      await expect(
        service(tx).signUp(request({ phone: first.phone })),
      ).rejects.toMatchObject({ code: 'PHONE_TAKEN', status: 409 });
    });
  });

  it('lets two organizations use the same sector and line codes (ADR-0012)', async () => {
    await withRollback(prisma, async (tx) => {
      const code = `LN-${randomUUID().slice(0, 8)}`;
      for (const input of [request(), request()]) {
        const { organizationId } = await service(tx).signUp(input);
        const sector = await tx.sector.create({
          data: { organizationId, code, name: 'North' },
        });
        await tx.line.create({
          data: { organizationId, sectorId: sector.id, code, name: 'Line 1' },
        });
      }
      expect(await tx.line.count({ where: { code } })).toBe(2);
    });
  });
});
