import type { PrismaClient } from '@repo/db';
import { testNotifications } from '../notifications/notices.js';
import {
  addCalendarDays,
  fromUtcMidnight,
  parseCalendarDate,
  toUtcMidnight,
} from '@repo/domain';
import { randomUUID } from 'node:crypto';

import { OverdueService } from '../../src/accounts/overdue.service.js';
import { AuditWriter } from '../../src/audit/audit.writer.js';
import type { RequestContext } from '../../src/platform/context/request-context.js';
import type { SystemContext } from '../../src/platform/context/system-context.js';
import { Database } from '../../src/platform/database/database.js';
import { SettingReader } from '../../src/settings/setting-reader.js';
import { SettingsService } from '../../src/settings/settings.service.js';
import { createTestPrismaClient } from '../database.js';
import {
  createActiveAccount,
  createLine,
  createStaff,
  decimal,
} from '../db-constraints/fixtures.js';
import { testRecorder } from '../security/recorder.js';
import { withRollback } from '../with-rollback.js';

/** What the security log records these refusals against (M13, ADR-0014). */
const SETTINGS_ROUTE = { method: 'PATCH', path: '/api/settings/:key' };

/**
 * Business settings (US-094) against real rows, rolled back, so the `setting`
 * rows, the organisation's own record and the audit entries can be inspected.
 *
 * The file is organised by the classification, because that is the story:
 * which settings may move freely, which apply only to what is created next,
 * and which the API must refuse once the business has history.
 */
describe('SettingsService (US-094)', () => {
  let prisma: PrismaClient;

  beforeAll(() => {
    prisma = createTestPrismaClient();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  async function world(tx: PrismaClient, organizationId?: string) {
    const id =
      organizationId ??
      (
        await tx.organization.create({
          data: {
            name: 'Rasi Test',
            timezone: 'Asia/Kolkata',
            currency: 'INR',
          },
        })
      ).id;
    const owner = await createStaff(tx, id, 'ADMIN');
    await tx.staffProfile.update({
      where: { id: owner.id },
      data: { role: 'SUPER_ADMIN' },
    });
    const context: RequestContext = {
      requestId: `req_${randomUUID()}`,
      userId: owner.userId,
      staffProfileId: owner.id,
      organizationId: id,
      role: 'SUPER_ADMIN',
      currentLineId: null,
    };
    const database = new Database(tx);
    return {
      context,
      organizationId: id,
      database,
      reader: new SettingReader(database),
      service: new SettingsService(
        database,
        new AuditWriter(database),
        testRecorder(tx, { route: SETTINGS_ROUTE }),
      ),
    };
  }

  const find = (
    result: { settings: { key: string }[] },
    key: string,
  ): Record<string, unknown> =>
    result.settings.find((setting) => setting.key === key) as unknown as Record<
      string,
      unknown
    >;

  const refusal = async (run: Promise<unknown>) =>
    run.then(
      () => ({ code: 'NO_ERROR', status: 0 }),
      (error: { code: string; status: number }) => error,
    );

  describe('reading them', () => {
    it('shows every setting at its built-in default until one is overridden', async () => {
      await withRollback(prisma, async (tx) => {
        const { context, service } = await world(tx);

        const result = await service.list(context);

        expect(result.hasHistory).toBe(false);
        expect(find(result, 'account.defaultTermDays')).toMatchObject({
          value: '100',
          defaultValue: '100',
          isOverridden: false,
          group: 'FORWARD_ONLY',
          editable: true,
        });
        expect(find(result, 'account.overdueGraceDays')).toMatchObject({
          value: '0',
          isOverridden: false,
          group: 'FREE',
        });
        expect(find(result, 'organisation.currency')).toMatchObject({
          value: 'INR',
          defaultValue: null,
          group: 'LOCKED',
        });
      });
    });

    it('answers an unknown key with 404, as it does a row out of scope', async () => {
      await withRollback(prisma, async (tx) => {
        const { context, service } = await world(tx);

        const error = await refusal(
          service.update(context, 'account.interestRate', '12'),
        );

        expect(error).toMatchObject({ code: 'SETTING_NOT_FOUND', status: 404 });
      });
    });
  });

  describe('group (a) — free to change: nothing stored is restated', () => {
    it('changes the business name and audits it with before and after, in the transaction', async () => {
      await withRollback(prisma, async (tx) => {
        const { context, service, organizationId } = await world(tx);

        const result = await service.update(
          context,
          'organisation.name',
          '  Rasi Finance  ',
        );

        expect(find(result, 'organisation.name')).toMatchObject({
          value: 'Rasi Finance',
        });
        const row = await tx.auditLog.findFirstOrThrow({
          where: { entityTable: 'organization', entityId: organizationId },
        });
        expect(row).toMatchObject({
          action: 'UPDATE',
          actorUserId: context.userId,
          organizationId,
          before: { setting: 'organisation.name', value: 'Rasi Test' },
          after: { setting: 'organisation.name', value: 'Rasi Finance' },
        });
      });
    });

    it('refuses a value the registry does not accept, before anything is written', async () => {
      await withRollback(prisma, async (tx) => {
        const { context, service, organizationId } = await world(tx);

        const error = await refusal(
          service.update(context, 'account.overdueGraceDays', '400'),
        );

        expect(error).toMatchObject({
          code: 'SETTING_VALUE_INVALID',
          status: 400,
        });
        expect(await tx.setting.count({ where: { organizationId } })).toBe(0);
      });
    });

    it('refuses the value already in force, so an audit entry always records a change', async () => {
      await withRollback(prisma, async (tx) => {
        const { context, service } = await world(tx);

        const error = await refusal(
          service.update(context, 'account.overdueGraceDays', '0'),
        );

        expect(error).toMatchObject({
          code: 'SETTING_UNCHANGED',
          status: 422,
        });
      });
    });

    /**
     * BR-05 with `account.overdueGraceDays` at 3: the flag is derived from the
     * dates every night, so the change applies to accounts that already exist
     * — which is exactly why it is free to change and a schedule value is not.
     */
    it('holds the overdue flag back by the grace days it is given (BR-05)', async () => {
      await withRollback(prisma, async (tx) => {
        const { account, organization } = await createActiveAccount(tx);
        const { context, service, database } = await world(tx, organization.id);
        const overdue = new OverdueService(
          database,
          new SettingReader(database),
          testNotifications(database).notices,
        );
        const system: SystemContext = {
          organizationId: organization.id,
          runId: `run_${randomUUID()}`,
        };
        const target = fromUtcMidnight(account.targetCompletionDate);
        // Two days past target: overdue with no grace, not yet with three.
        const today = addCalendarDays(target, 2);

        await overdue.flag(system, today);
        expect(
          (
            await tx.accountLoan.findUniqueOrThrow({
              where: { id: account.id },
            })
          ).isOverdue,
        ).toBe(true);

        await service.update(context, 'account.overdueGraceDays', '3');
        await overdue.flag(system, today);

        expect(
          (
            await tx.accountLoan.findUniqueOrThrow({
              where: { id: account.id },
            })
          ).isOverdue,
        ).toBe(false);
      });
    });
  });

  describe('group (b) — forward only: read once, at creation', () => {
    it('moves the default term without touching an existing account or its schedule', async () => {
      await withRollback(prisma, async (tx) => {
        const { account, organization } = await createActiveAccount(tx);
        const { context, service, reader } = await world(tx, organization.id);
        const firstDue = parseCalendarDate('2026-09-02');
        await tx.accountSchedule.createMany({
          data: [1, 2, 3].map((sequence) => ({
            accountLoanId: account.id,
            sequence,
            dueDate: toUtcMidnight(addCalendarDays(firstDue, sequence - 1)),
            expectedAmount: decimal('100.00'),
          })),
        });
        const before = await tx.accountSchedule.findMany({
          where: { accountLoanId: account.id },
          orderBy: { sequence: 'asc' },
          select: { sequence: true, dueDate: true, expectedAmount: true },
        });

        await service.update(context, 'account.defaultTermDays', '60');

        // What a new account would now start at …
        expect(
          await reader.number(organization.id, 'account.defaultTermDays'),
        ).toBe(60);
        // … while the account created under 100 keeps its term and its slots.
        const after = await tx.accountLoan.findUniqueOrThrow({
          where: { id: account.id },
          select: { termDays: true, targetCompletionDate: true },
        });
        expect(after.termDays).toBe(100);
        expect(after.targetCompletionDate).toEqual(
          account.targetCompletionDate,
        );
        expect(
          await tx.accountSchedule.findMany({
            where: { accountLoanId: account.id },
            orderBy: { sequence: 'asc' },
            select: { sequence: true, dueDate: true, expectedAmount: true },
          }),
        ).toEqual(before);
      });
    });

    it('writes the override as a setting row, audited with before and after', async () => {
      await withRollback(prisma, async (tx) => {
        const { context, service, organizationId } = await world(tx);

        await service.update(context, 'account.defaultTermDays', '60');

        const row = await tx.setting.findFirstOrThrow({
          where: { organizationId, key: 'account.defaultTermDays' },
        });
        expect(row.value).toBe(60);
        expect(
          await tx.auditLog.findFirstOrThrow({
            where: { entityTable: 'setting', entityId: row.id },
          }),
        ).toMatchObject({
          action: 'CREATE',
          actorUserId: context.userId,
          before: { setting: 'account.defaultTermDays', value: '100' },
          after: { setting: 'account.defaultTermDays', value: '60' },
        });
      });
    });

    it('resets to the built-in default by removing the override, audited as a deletion', async () => {
      await withRollback(prisma, async (tx) => {
        const { context, service, organizationId } = await world(tx);
        await service.update(context, 'account.defaultTermDays', '60');
        const row = await tx.setting.findFirstOrThrow({
          where: { organizationId, key: 'account.defaultTermDays' },
        });

        const result = await service.update(
          context,
          'account.defaultTermDays',
          null,
        );

        expect(find(result, 'account.defaultTermDays')).toMatchObject({
          value: '100',
          isOverridden: false,
        });
        expect(await tx.setting.count({ where: { organizationId } })).toBe(0);
        expect(
          await tx.auditLog.findFirstOrThrow({
            where: {
              entityTable: 'setting',
              entityId: row.id,
              action: 'DELETE',
            },
          }),
        ).toMatchObject({
          before: { setting: 'account.defaultTermDays', value: '60' },
          after: { setting: 'account.defaultTermDays', value: '100' },
        });
      });
    });

    it('refuses a reset when nothing is overridden, and when there is no default to return to', async () => {
      await withRollback(prisma, async (tx) => {
        const { context, service } = await world(tx);

        expect(
          await refusal(
            service.update(context, 'account.defaultTermDays', null),
          ),
        ).toMatchObject({ code: 'SETTING_NOT_OVERRIDDEN', status: 422 });
        expect(
          await refusal(service.update(context, 'organisation.name', null)),
        ).toMatchObject({ code: 'SETTING_HAS_NO_DEFAULT', status: 422 });
      });
    });
  });

  describe('group (c) — locked: changing it would restate history', () => {
    it('refuses the time zone and the sign-in link outright, whatever the state of the business', async () => {
      await withRollback(prisma, async (tx) => {
        const { context, service } = await world(tx);

        expect(
          await refusal(
            service.update(context, 'organisation.timezone', 'Asia/Dubai'),
          ),
        ).toMatchObject({ code: 'SETTING_IMMUTABLE', status: 422 });
        expect(
          await refusal(
            service.update(context, 'organisation.slug', 'rasi-two'),
          ),
        ).toMatchObject({ code: 'SETTING_IMMUTABLE', status: 422 });
        expect(
          (
            await tx.organization.findUniqueOrThrow({
              where: { id: context.organizationId },
            })
          ).timezone,
        ).toBe('Asia/Kolkata');
      });
    });

    it('lets a business with no account correct its currency', async () => {
      await withRollback(prisma, async (tx) => {
        const { context, service } = await world(tx);

        const result = await service.update(
          context,
          'organisation.currency',
          'aed',
        );

        expect(find(result, 'organisation.currency')).toMatchObject({
          value: 'AED',
          editable: true,
        });
      });
    });

    it('refuses the currency once one account exists, because every posted amount is in it', async () => {
      await withRollback(prisma, async (tx) => {
        const { organization } = await createActiveAccount(tx);
        const { context, service } = await world(tx, organization.id);

        const error = await refusal(
          service.update(context, 'organisation.currency', 'AED'),
        );

        expect(error).toMatchObject({
          code: 'SETTING_LOCKED_BY_HISTORY',
          status: 422,
        });
        expect(
          (
            await tx.organization.findUniqueOrThrow({
              where: { id: organization.id },
            })
          ).currency,
        ).toBe('INR');
        const listed = await service.list(context);
        expect(listed.hasHistory).toBe(true);
        expect(find(listed, 'organisation.currency')).toMatchObject({
          editable: false,
        });
        expect(find(listed, 'organisation.currency').lockedReason).toEqual(
          expect.stringContaining('already posted'),
        );
      });
    });

    it('locks nothing else when history appears — the free and forward-only settings still move', async () => {
      await withRollback(prisma, async (tx) => {
        const { organization } = await createActiveAccount(tx);
        const { context, service } = await world(tx, organization.id);

        const result = await service.update(
          context,
          'account.defaultTermDays',
          '75',
        );

        expect(find(result, 'account.defaultTermDays')).toMatchObject({
          value: '75',
          editable: true,
        });
        expect(find(result, 'organisation.name')).toMatchObject({
          editable: true,
        });
      });
    });
  });

  /**
   * The security log (ADR-0014) — a locked setting is where an owner-level guard gets tested, and a
   * lock that was reached for repeatedly is exactly what a security log is for.
   */
  describe('the refused attempt is recorded (M13, ADR-0014)', () => {
    const events = (tx: PrismaClient, organizationId: string) =>
      tx.securityEvent.findMany({
        where: { organizationId },
        orderBy: { createdAt: 'asc' },
      });

    it('records both locks and the unknown key, against the setting that was aimed at', async () => {
      await withRollback(prisma, async (tx) => {
        const { organization } = await createActiveAccount(tx);
        const { context, service } = await world(tx, organization.id);

        await refusal(service.update(context, 'organisation.timezone', 'UTC'));
        await refusal(service.update(context, 'organisation.currency', 'AED'));
        await refusal(service.update(context, 'account.interestRate', '12'));

        expect(await events(tx, organization.id)).toMatchObject([
          {
            actorUserId: context.userId,
            actorRole: 'SUPER_ADMIN',
            kind: 'SETTING_LOCKED',
            code: 'SETTING_IMMUTABLE',
            status: 422,
            method: SETTINGS_ROUTE.method,
            path: SETTINGS_ROUTE.path,
            targetTable: 'setting',
            targetId: 'organisation.timezone',
          },
          {
            kind: 'SETTING_LOCKED',
            code: 'SETTING_LOCKED_BY_HISTORY',
            targetId: 'organisation.currency',
          },
          {
            kind: 'OUT_OF_SCOPE',
            code: 'SETTING_NOT_FOUND',
            status: 404,
            targetId: 'account.interestRate',
          },
        ]);
      });
    });

    it('survives the rollback of the transaction the lock was raised inside', async () => {
      await withRollback(prisma, async (tx) => {
        const { organization } = await createActiveAccount(tx);
        const { context, service } = await world(tx, organization.id);

        // SETTING_LOCKED_BY_HISTORY is thrown after the organisation row has
        // been taken FOR UPDATE, inside `Database.transaction`. The record is
        // written once that has rejected — so the refusal is still there.
        await refusal(service.update(context, 'organisation.currency', 'AED'));

        expect(
          (
            await tx.organization.findUniqueOrThrow({
              where: { id: organization.id },
            })
          ).currency,
        ).toBe('INR');
        expect(await events(tx, organization.id)).toHaveLength(1);
      });
    });

    it('records nothing for a value the registry simply rejects', async () => {
      await withRollback(prisma, async (tx) => {
        const { context, service, organizationId } = await world(tx);

        await refusal(
          service.update(context, 'account.defaultTermDays', 'ninety'),
        );
        await refusal(
          service.update(context, 'organisation.name', 'Rasi Test'),
        );

        expect(await events(tx, organizationId)).toEqual([]);
      });
    });
  });

  describe('scope (M02)', () => {
    it('never reads or writes another organisation’s settings', async () => {
      await withRollback(prisma, async (tx) => {
        const { organization: other } = await createLine(tx);
        await tx.setting.create({
          data: {
            organizationId: other.id,
            key: 'account.defaultTermDays',
            value: 45,
            description: 'someone else’s',
          },
        });
        const { context, service, organizationId } = await world(tx);

        const result = await service.list(context);
        expect(find(result, 'account.defaultTermDays')).toMatchObject({
          value: '100',
        });

        await service.update(context, 'account.defaultTermDays', '80');
        expect(
          (
            await tx.setting.findFirstOrThrow({
              where: { organizationId: other.id },
            })
          ).value,
        ).toBe(45);
        expect(await tx.setting.count({ where: { organizationId } })).toBe(1);
      });
    });
  });
});
