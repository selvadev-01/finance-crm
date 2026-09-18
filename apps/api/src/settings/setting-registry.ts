import type { SettingGroup } from '@repo/contracts';

import { ValidationError } from '../platform/errors/errors.js';

/**
 * The business settings a Super Admin may see and change (M15, US-094).
 *
 * **Defaults live here, in code; the `setting` table holds only overrides.**
 * That is the M15 rule, and it is what keeps a settings screen honest: a value
 * nobody changed reads the same in the database, in a fresh organisation and
 * in this file.
 *
 * Every entry declares which of three groups it is in, and the group decides
 * what `SettingsService` allows. The classification is the whole point of the
 * story, so the reasoning is written on each entry rather than left implicit:
 *
 * - **`FREE`** — the new value applies and nothing stored is restated. Only a
 *   setting that feeds no money figure and no schedule qualifies.
 * - **`FORWARD_ONLY`** — read once, when a record is created, and copied onto
 *   it. `account.defaultTermDays` is the case: `account_loan.termDays` is
 *   stamped at creation and the schedule generated from it (BR-04/06/07), so
 *   nothing ever re-reads the setting for an account that already exists.
 * - **`LOCKED`** — refused. Either always, or once the organisation has an
 *   account, because every posted amount and generated slot was written under
 *   the current value and changing it would restate the past without touching
 *   a single row.
 *
 * A setting nothing reads is worse than no setting at all (M15 says so of
 * `collection.varianceTolerance`), so every key here has a live consumer.
 */
export type SettingSection = 'ORGANISATION' | 'ACCOUNTS';
export type SettingValueType = 'INTEGER' | 'TEXT';

/** Why a setting may not be changed, and when that bites. */
export type SettingLock =
  | { kind: 'NONE' }
  /** Never changeable, whatever the state of the business. */
  | { kind: 'ALWAYS'; reason: string }
  /** Changeable only while the organisation has no account at all. */
  | { kind: 'ONCE_ACCOUNTS_EXIST'; reason: string };

/** Where the value actually lives. */
export type SettingStorage =
  /** A `setting` row keyed by `(organizationId, key)`; absent means default. */
  | { kind: 'SETTING'; defaultValue: string }
  /** A column of the organisation's own row, which has no built-in default. */
  | { kind: 'ORGANIZATION'; column: 'name' | 'slug' | 'timezone' | 'currency' };

export interface SettingDefinition {
  key: string;
  label: string;
  description: string;
  section: SettingSection;
  group: SettingGroup;
  valueType: SettingValueType;
  /** What changing it does — the sentence S-28 shows beside the value. */
  effect: string;
  lock: SettingLock;
  storage: SettingStorage;
  /** Validates and normalises a submitted value, or refuses it with `400`. */
  parse: (raw: string) => string;
}

/** A whole number in range. Counts, never money — money would be a decimal string. */
function wholeNumber(min: number, max: number, noun: string) {
  return (raw: string): string => {
    const text = raw.trim();
    const refuse = () => {
      throw new ValidationError(
        'SETTING_VALUE_INVALID',
        `${noun} must be a whole number between ${min} and ${max}.`,
        [
          {
            field: 'value',
            issue: `must be a whole number between ${min} and ${max}`,
          },
        ],
      );
    };
    if (!/^\d{1,6}$/.test(text)) refuse();
    const value = Number(text);
    if (value < min || value > max) refuse();
    return String(value);
  };
}

function text(min: number, max: number, noun: string) {
  return (raw: string): string => {
    const value = raw.trim();
    if (value.length < min || value.length > max) {
      throw new ValidationError(
        'SETTING_VALUE_INVALID',
        `${noun} must be between ${min} and ${max} characters.`,
        [{ field: 'value', issue: `must be ${min} to ${max} characters` }],
      );
    }
    return value;
  };
}

function currencyCode(raw: string): string {
  const value = raw.trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(value)) {
    throw new ValidationError(
      'SETTING_VALUE_INVALID',
      'A currency is a three-letter code, such as INR.',
      [{ field: 'value', issue: 'must be a three-letter currency code' }],
    );
  }
  return value;
}

export const SETTING_DEFINITIONS: readonly SettingDefinition[] = [
  {
    key: 'organisation.name',
    label: 'Business name',
    description: 'What the business is called, on every screen and email.',
    section: 'ORGANISATION',
    // Display only. No figure, date or schedule is derived from it.
    group: 'FREE',
    valueType: 'TEXT',
    effect: 'Appears everywhere at once. Nothing already recorded changes.',
    lock: { kind: 'NONE' },
    storage: { kind: 'ORGANIZATION', column: 'name' },
    parse: text(1, 120, 'The business name'),
  },
  {
    key: 'organisation.slug',
    label: 'Sign-in link',
    description:
      'The address staff sign in at — rasi.app/<slug>/sign-in (US-006).',
    section: 'ORGANISATION',
    group: 'LOCKED',
    valueType: 'TEXT',
    effect: 'Fixed at sign-up so every saved sign-in link keeps working.',
    lock: {
      kind: 'ALWAYS',
      reason:
        'The sign-in link is generated once at sign-up (ADR-0012). Changing it would break the link every staff member has saved on their phone.',
    },
    storage: { kind: 'ORGANIZATION', column: 'slug' },
    parse: text(3, 64, 'The sign-in link'),
  },
  {
    key: 'organisation.timezone',
    label: 'Time zone',
    description: 'The zone a collection’s business date is decided in.',
    section: 'ORGANISATION',
    group: 'LOCKED',
    valueType: 'TEXT',
    effect: 'Settled in code as Asia/Kolkata (BR-12). Shown here, never set.',
    lock: {
      kind: 'ALWAYS',
      reason:
        'The business date is settled in code as Asia/Kolkata (BR-12). A different value here would change nothing, or — worse — silently misfile every collection recorded near midnight.',
    },
    storage: { kind: 'ORGANIZATION', column: 'timezone' },
    parse: text(3, 64, 'The time zone'),
  },
  {
    key: 'organisation.currency',
    label: 'Currency',
    description: 'The unit every amount in Rasi is recorded in.',
    section: 'ORGANISATION',
    group: 'LOCKED',
    valueType: 'TEXT',
    effect:
      'Can be corrected while the business has no account. After the first one it is history.',
    lock: {
      kind: 'ONCE_ACCOUNTS_EXIST',
      reason:
        'Every amount already posted — accounts, collections and ledger entries — is in this currency. Changing it would relabel all of them without converting a single figure.',
    },
    storage: { kind: 'ORGANIZATION', column: 'currency' },
    parse: currencyCode,
  },
  {
    key: 'account.defaultTermDays',
    label: 'Default term',
    description:
      'The term N a new account starts at on the creation form (M05).',
    section: 'ACCOUNTS',
    // Read once, at creation, and copied onto account_loan.termDays. An
    // existing account's schedule was generated from the value in force then
    // (BR-04/06/07) and is never regenerated from this one.
    group: 'FORWARD_ONLY',
    valueType: 'INTEGER',
    effect:
      'Applies to accounts created from now on. Existing accounts keep their own term and their schedules are untouched.',
    lock: { kind: 'NONE' },
    storage: { kind: 'SETTING', defaultValue: '100' },
    parse: wholeNumber(1, 1000, 'The default term'),
  },
  {
    key: 'account.overdueGraceDays',
    label: 'Overdue grace',
    description:
      'Days past an account’s target completion date before it is flagged overdue (BR-05).',
    section: 'ACCOUNTS',
    // isOverdue is a derived flag, recomputed every night from the dates
    // (OverdueService). It restates no amount and moves no schedule slot, so
    // it is free to change — business-rules.md open question 3 set it to zero.
    group: 'FREE',
    valueType: 'INTEGER',
    effect:
      'Applies at tonight’s run, to every account. The flag is derived from the dates — no amount or schedule changes.',
    lock: { kind: 'NONE' },
    storage: { kind: 'SETTING', defaultValue: '0' },
    parse: wholeNumber(0, 30, 'The overdue grace'),
  },
] as const;

const BY_KEY = new Map(
  SETTING_DEFINITIONS.map((definition) => [definition.key, definition]),
);

export function settingDefinition(key: string): SettingDefinition | undefined {
  return BY_KEY.get(key);
}

/** Keys whose value is a whole number in a `setting` row. */
export type IntegerSettingKey =
  'account.defaultTermDays' | 'account.overdueGraceDays';

/** The built-in default of a `setting`-backed key, as a number. */
export function builtInNumber(key: IntegerSettingKey): number {
  const definition = BY_KEY.get(key);
  if (!definition || definition.storage.kind !== 'SETTING') {
    throw new Error(`${key} is not a stored numeric setting`);
  }
  return Number(definition.storage.defaultValue);
}
