import { Injectable } from '@nestjs/common';
import type { BusinessSetting, BusinessSettings } from '@repo/contracts';
import type { Prisma } from '@repo/db';

import { AuditWriter } from '../audit/audit.writer.js';
import type { RequestContext } from '../platform/context/request-context.js';
import { Database } from '../platform/database/database.js';
import {
  DomainError,
  InternalError,
  NotFoundError,
} from '../platform/errors/errors.js';
import {
  SETTING_DEFINITIONS,
  type SettingDefinition,
  settingDefinition,
} from './setting-registry.js';

type Tx = Prisma.TransactionClient;

interface Organisation {
  name: string;
  slug: string;
  timezone: string;
  currency: string;
}

/**
 * Business settings (M15, US-094). Super Admin only, and every change audited
 * with before and after — `settings.change` is the one permission that alters
 * how the system behaves for everyone (rbac-matrix.md).
 *
 * The service's real job is the classification in `setting-registry.ts`. Three
 * refusals carry it, and each is an API refusal with a stable code rather than
 * a button the screen leaves out:
 *
 * - `SETTING_IMMUTABLE` (422) — the sign-in link and the time zone. Both are
 *   settled elsewhere (ADR-0012, BR-12) and shown here so a Super Admin can
 *   read them, never set them.
 * - `SETTING_LOCKED_BY_HISTORY` (422) — the currency, once the organisation
 *   has an account. Every posted amount is in it; changing it afterwards would
 *   relabel history without converting a figure.
 * - `SETTING_VALUE_INVALID` (400) — the registry's own range and shape checks,
 *   so an invalid value is rejected rather than stored (M15's first risk).
 *
 * The fourth guard is not a refusal but an absence: a `FORWARD_ONLY` setting
 * is read **once**, when a record is created, and copied onto it. Nothing here
 * rewrites an existing row, and nothing re-reads the setting for one — which
 * is why `account.defaultTermDays` can move without disturbing a single
 * generated schedule (BR-04/06/07).
 */
@Injectable()
export class SettingsService {
  constructor(
    private readonly database: Database,
    private readonly audit: AuditWriter,
  ) {}

  /** S-28: every setting, its value, its default, and whether it may move. */
  async list(context: RequestContext): Promise<BusinessSettings> {
    const client = this.database.client;
    const [organisation, overrides, history] = await Promise.all([
      client.organization.findUniqueOrThrow({
        where: { id: context.organizationId },
        select: { name: true, slug: true, timezone: true, currency: true },
      }),
      client.setting.findMany({
        where: { organizationId: context.organizationId },
        select: { key: true, value: true },
      }),
      client.accountLoan.findFirst({
        where: { organizationId: context.organizationId },
        select: { id: true },
      }),
    ]);
    const stored = new Map(
      overrides.map((row) => [row.key, asText(row.value)] as const),
    );
    const hasHistory = history !== null;
    return {
      hasHistory,
      settings: SETTING_DEFINITIONS.map((definition) =>
        describe(
          definition,
          organisation,
          stored.get(definition.key),
          hasHistory,
        ),
      ),
    };
  }

  /**
   * US-094: change one setting, or — with `null` — drop the override and go
   * back to the built-in default. The whole set comes back, because one change
   * can change what another allows.
   */
  async update(
    context: RequestContext,
    key: string,
    value: string | null,
  ): Promise<BusinessSettings> {
    const definition = settingDefinition(key);
    // An unknown key is the same answer as one outside the caller's scope (M02).
    if (!definition) {
      throw new NotFoundError('SETTING_NOT_FOUND', 'Setting not found');
    }
    // Refused before the value is even looked at: a locked setting has no
    // valid value, and telling the caller its range would be misleading.
    if (definition.lock.kind === 'ALWAYS') {
      throw new DomainError('SETTING_IMMUTABLE', definition.lock.reason, [
        { field: 'value', issue: 'this setting cannot be changed' },
      ]);
    }
    const parsed = value === null ? null : definition.parse(value);

    return this.database.transaction(async (tx) => {
      // Inside the transaction: an account created concurrently either is seen
      // here or waits, so the currency can never move under the first one.
      const history = await tx.accountLoan.findFirst({
        where: { organizationId: context.organizationId },
        select: { id: true },
      });
      if (definition.lock.kind === 'ONCE_ACCOUNTS_EXIST' && history) {
        throw new DomainError(
          'SETTING_LOCKED_BY_HISTORY',
          definition.lock.reason,
          [{ field: 'value', issue: 'the business already has accounts' }],
        );
      }
      if (definition.storage.kind === 'ORGANIZATION') {
        await this.writeOrganisation(tx, context, definition, parsed);
      } else {
        await this.writeSetting(tx, context, definition, parsed);
      }
      return this.list(context);
    });
  }

  /** The organisation's own row. Only `name` and `currency` ever reach here. */
  private async writeOrganisation(
    tx: Tx,
    context: RequestContext,
    definition: SettingDefinition,
    parsed: string | null,
  ): Promise<void> {
    if (definition.storage.kind !== 'ORGANIZATION') return;
    const column = definition.storage.column;
    if (parsed === null) {
      throw new DomainError(
        'SETTING_HAS_NO_DEFAULT',
        `${definition.label} has no built-in default to go back to — it is part of the organisation's own record.`,
        [{ field: 'value', issue: 'cannot be reset' }],
      );
    }
    if (column !== 'name' && column !== 'currency') {
      // slug and timezone are locked ALWAYS and never get this far.
      throw new InternalError(
        'SETTING_NOT_WRITABLE',
        `${definition.key} reached the writer but is not a writable column`,
      );
    }
    const before = await tx.organization.findUniqueOrThrow({
      where: { id: context.organizationId },
      select: { name: true, currency: true },
    });
    const current = before[column];
    if (current === parsed) throw unchanged(definition);
    await tx.organization.update({
      where: { id: context.organizationId },
      data: column === 'name' ? { name: parsed } : { currency: parsed },
    });
    await this.audit.record(context, {
      action: 'UPDATE',
      entityTable: 'organization',
      entityId: context.organizationId,
      before: { setting: definition.key, value: current },
      after: { setting: definition.key, value: parsed },
    });
  }

  /** A `setting` row: written when it differs from the default, removed on reset. */
  private async writeSetting(
    tx: Tx,
    context: RequestContext,
    definition: SettingDefinition,
    parsed: string | null,
  ): Promise<void> {
    if (definition.storage.kind !== 'SETTING') return;
    const fallback = definition.storage.defaultValue;
    const existing = await tx.setting.findUnique({
      where: {
        organizationId_key: {
          organizationId: context.organizationId,
          key: definition.key,
        },
      },
      select: { id: true, value: true },
    });
    const current = existing ? (asText(existing.value) ?? fallback) : fallback;

    if (parsed === null) {
      if (!existing) {
        throw new DomainError(
          'SETTING_NOT_OVERRIDDEN',
          `${definition.label} is already at its built-in default of ${fallback}.`,
          [{ field: 'value', issue: 'there is nothing to reset' }],
        );
      }
      await tx.setting.delete({ where: { id: existing.id } });
      await this.audit.record(context, {
        action: 'DELETE',
        entityTable: 'setting',
        entityId: existing.id,
        before: { setting: definition.key, value: current },
        after: { setting: definition.key, value: fallback },
      });
      return;
    }

    if (current === parsed) throw unchanged(definition);
    const value = definition.valueType === 'INTEGER' ? Number(parsed) : parsed;
    const row = await tx.setting.upsert({
      where: {
        organizationId_key: {
          organizationId: context.organizationId,
          key: definition.key,
        },
      },
      create: {
        organizationId: context.organizationId,
        key: definition.key,
        value,
        description: definition.description,
        createdByUserId: context.userId,
      },
      update: { value },
      select: { id: true },
    });
    await this.audit.record(context, {
      action: existing ? 'UPDATE' : 'CREATE',
      entityTable: 'setting',
      entityId: row.id,
      before: { setting: definition.key, value: current },
      after: { setting: definition.key, value: parsed },
    });
  }
}

function unchanged(definition: SettingDefinition): DomainError {
  return new DomainError(
    'SETTING_UNCHANGED',
    `${definition.label} already has that value.`,
    [{ field: 'value', issue: 'is the value already in force' }],
  );
}

/** One setting as S-28 reads it. */
function describe(
  definition: SettingDefinition,
  organisation: Organisation,
  override: string | undefined,
  hasHistory: boolean,
): BusinessSetting {
  const locked =
    definition.lock.kind === 'ALWAYS' ||
    (definition.lock.kind === 'ONCE_ACCOUNTS_EXIST' && hasHistory);
  const defaultValue =
    definition.storage.kind === 'SETTING'
      ? definition.storage.defaultValue
      : null;
  const value =
    definition.storage.kind === 'SETTING'
      ? (override ?? definition.storage.defaultValue)
      : organisation[definition.storage.column];
  return {
    key: definition.key,
    label: definition.label,
    description: definition.description,
    section: definition.section,
    group: definition.group,
    valueType: definition.valueType,
    effect: definition.effect,
    value,
    defaultValue,
    isOverridden: defaultValue !== null && value !== defaultValue,
    editable: !locked,
    lockedReason:
      locked && definition.lock.kind !== 'NONE' ? definition.lock.reason : null,
  };
}

/** A stored JSON value as the string the contract carries. */
function asText(value: unknown): string | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  if (typeof value === 'string') return value;
  return undefined;
}
