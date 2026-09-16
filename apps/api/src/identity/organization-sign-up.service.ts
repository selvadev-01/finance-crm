import { randomUUID } from 'node:crypto';

import { Injectable } from '@nestjs/common';
import type {
  OrganizationPublic,
  SignUpRequest,
  SignUpResult,
} from '@repo/contracts';
import {
  BUSINESS_TIME_ZONE,
  toBusinessDate,
  toUtcMidnight,
} from '@repo/domain';

import { AuditWriter } from '../audit/audit.writer.js';
import { EmailOutbox } from '../email/email-outbox.js';
import { welcomeEmail } from '../email/email-templates.js';
import { isUniqueViolation } from '../organisation/prisma-errors.js';
import {
  getRequestClient,
  getRequestId,
  type RequestContext,
} from '../platform/context/request-context.js';
import { Database } from '../platform/database/database.js';
import {
  ConflictError,
  NotFoundError,
  RateLimitError,
} from '../platform/errors/errors.js';
import {
  firstFreeSlug,
  randomSlug,
  slugFromName,
} from './organization-slug.js';
import { PasswordHasher } from './password-hasher.js';
import { SignUpRateLimiter } from './sign-up-rate-limiter.js';

/** The business is India-only (M15); the column records it, BR-12 decides it. */
const CURRENCY = 'INR';

/** A concurrent sign-up can take the chosen slug; retry with a fresh choice. */
const SLUG_ATTEMPTS = 3;

/**
 * Organization sign-up (M01, US-006, ADR-0012).
 *
 * Public. A new business and its owner, as Super Admin, in one transaction:
 * the `organization` row with a slug generated from its name, the Better Auth
 * `user` and its password credential, the `staff_profile`, and an audit entry
 * for the organization and for the staff profile. The owner is the actor —
 * there is no one else — and signs in with the password they chose, so
 * `mustChangePassword` stays clear. With email configured, a welcome email
 * carrying the business's sign-in link is queued in the same transaction.
 *
 * Abuse control is a per-address rate limit (`SignUpRateLimiter`). Ledger
 * accounts are not created here — `LedgerService` creates each on first use.
 */
@Injectable()
export class OrganizationSignUpService {
  constructor(
    private readonly database: Database,
    private readonly audit: AuditWriter,
    private readonly hasher: PasswordHasher,
    private readonly limiter: SignUpRateLimiter,
    private readonly emails: EmailOutbox,
  ) {}

  async signUp(input: SignUpRequest): Promise<SignUpResult> {
    const address = getRequestClient()?.ipAddress ?? 'unknown';
    if (!this.limiter.tryConsume(address)) {
      throw new RateLimitError(
        'SIGN_UP_RATE_LIMITED',
        'Too many sign-up attempts from this network. Try again in an hour.',
      );
    }
    // Checked before the transaction so the common refusal is a clear 409
    // naming the field; the unique indexes still decide a race, below.
    await this.checkAvailable(input);
    // Hashing is deliberately slow; do it before the transaction opens.
    const passwordHash = await this.hasher.hash(input.password);

    for (let attempt = 1; ; attempt += 1) {
      const slug = await this.chooseSlug(input.organizationName);
      try {
        return await this.create(input, slug, passwordHash);
      } catch (error) {
        if (!isUniqueViolation(error)) throw error;
        // Name which of email or phone a concurrent sign-up took, if either.
        await this.checkAvailable(input);
        // Otherwise it was the slug. Inside a caller's transaction the failed
        // insert has aborted it, so there is nothing to retry into.
        if (attempt >= SLUG_ATTEMPTS || this.database.inTransaction)
          throw error;
      }
    }
  }

  /** The name behind a sign-in link. Unknown slugs are `404`. */
  async findBySlug(slug: string): Promise<OrganizationPublic> {
    const organization = await this.database.client.organization.findUnique({
      where: { slug },
      select: { slug: true, name: true },
    });
    if (!organization) {
      throw new NotFoundError(
        'ORGANIZATION_NOT_FOUND',
        'No business uses this sign-in link',
      );
    }
    return organization;
  }

  private create(
    input: SignUpRequest,
    slug: string,
    passwordHash: string,
  ): Promise<SignUpResult> {
    return this.database.transaction(async (tx) => {
      const organization = await tx.organization.create({
        data: {
          name: input.organizationName,
          slug,
          timezone: BUSINESS_TIME_ZONE,
          currency: CURRENCY,
        },
        select: { id: true, name: true, slug: true },
      });
      const userId = randomUUID();
      await tx.user.create({
        data: {
          id: userId,
          name: input.name,
          email: input.email,
          emailVerified: false,
        },
      });
      await tx.account.create({
        data: {
          id: randomUUID(),
          accountId: userId,
          providerId: 'credential',
          userId,
          password: passwordHash,
        },
      });
      const staff = await tx.staffProfile.create({
        data: {
          organizationId: organization.id,
          userId,
          staffCode: `OWNER-${randomUUID().slice(0, 8).toUpperCase()}`,
          role: 'SUPER_ADMIN',
          phone: input.phone,
          joinedAt: toUtcMidnight(toBusinessDate(new Date())),
        },
        select: { id: true, staffCode: true },
      });

      const owner: RequestContext = {
        requestId: getRequestId() ?? 'organization-sign-up',
        userId,
        staffProfileId: staff.id,
        organizationId: organization.id,
        role: 'SUPER_ADMIN',
        currentLineId: null,
      };
      await this.audit.record(owner, {
        action: 'CREATE',
        entityTable: 'organization',
        entityId: organization.id,
        after: {
          name: organization.name,
          slug: organization.slug,
          signUp: true,
        },
      });
      await this.audit.record(owner, {
        action: 'CREATE',
        entityTable: 'staff_profile',
        entityId: staff.id,
        after: { role: 'SUPER_ADMIN', staffCode: staff.staffCode },
      });
      await this.emails.queue({
        organizationId: organization.id,
        userId,
        kind: 'WELCOME',
        content: welcomeEmail({
          ownerName: input.name,
          organizationName: organization.name,
          signInUrl: this.emails.link(`/${organization.slug}/sign-in`),
        }),
      });
      return {
        organizationId: organization.id,
        staffProfileId: staff.id,
        slug: organization.slug,
      };
    });
  }

  /** The name's slug, numbered past any already taken (ADR-0012). */
  private async chooseSlug(name: string): Promise<string> {
    const base = slugFromName(name);
    if (base === null) return randomSlug();
    const taken = await this.database.client.organization.findMany({
      where: { OR: [{ slug: base }, { slug: { startsWith: `${base}-` } }] },
      select: { slug: true },
    });
    return firstFreeSlug(base, new Set(taken.map((row) => row.slug)));
  }

  private async checkAvailable(input: SignUpRequest): Promise<void> {
    const [user, staff] = await Promise.all([
      this.database.client.user.findFirst({
        where: { email: input.email },
        select: { id: true },
      }),
      this.database.client.staffProfile.findFirst({
        where: { phone: input.phone },
        select: { id: true },
      }),
    ]);
    if (user) {
      throw new ConflictError(
        'EMAIL_TAKEN',
        'That email already has a Rasi account. Sign in instead, or use another email.',
        [{ field: 'email', issue: 'already has an account' }],
      );
    }
    if (staff) {
      throw new ConflictError(
        'PHONE_TAKEN',
        'That mobile number already belongs to a staff member. Use another number.',
        [{ field: 'phone', issue: 'already belongs to a staff member' }],
      );
    }
  }
}
