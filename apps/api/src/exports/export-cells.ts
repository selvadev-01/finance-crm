import { BUSINESS_TIME_ZONE, toMoney } from '@repo/domain';

import { InternalError } from '../platform/errors/errors.js';
import type { ColumnKind, ExportCell } from './export-document.js';

/**
 * How one cell is checked and written, shared by both renderers. Money stays
 * a decimal string from the API's services to the file (non-negotiable 1);
 * the one exception is the number an Excel cell must hold, made — and proven
 * exact — in {@link excelNumber}.
 */

const MONEY = /^-?\d{1,12}(\.\d{1,2})?$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Refuses a cell that does not hold what its column says: a builder that put
 * a number in a money column is a bug, and the file must not be written.
 */
export function assertCell(kind: ColumnKind, value: ExportCell): void {
  if (value === null || value === '') return;
  const valid =
    kind === 'money'
      ? typeof value === 'string' && MONEY.test(value)
      : kind === 'count'
        ? typeof value === 'number' && Number.isSafeInteger(value)
        : kind === 'date'
          ? typeof value === 'string' && DATE.test(value)
          : typeof value === 'string';
  if (!valid) {
    throw new InternalError(
      'EXPORT_CELL_INVALID',
      `An export cell of kind ${kind} holds ${typeof value}`,
    );
  }
}

/**
 * `-1234567.5` → `-12,34,567.50`: Indian grouping, always two places, from
 * the string alone — never through a `number`.
 */
export function formatMoney(value: string): string {
  const amount = toMoney(value).toFixed(2);
  const negative = amount.startsWith('-');
  const [rupees = '0', paise = '00'] = (
    negative ? amount.slice(1) : amount
  ).split('.');
  const last3 = rupees.slice(-3);
  const rest = rupees.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ',');
  return `${negative ? '-' : ''}${rest ? `${rest},${last3}` : last3}.${paise}`;
}

/** `1250` → `1,250`, grouped as money is. */
export function formatCount(value: number): string {
  return formatMoney(String(value)).slice(0, -3);
}

/**
 * The number an Excel money cell holds. XLSX stores every numeric cell as an
 * IEEE-754 double — the file format allows nothing else — so a spreadsheet
 * that can sum a column needs one. `NUMERIC(14,2)` is at most 14 significant
 * digits and a double round-trips 15, so the conversion is exact; this proves
 * it for every cell rather than trusting the arithmetic, and refuses the file
 * if a value ever does not survive.
 */
export function excelNumber(value: string): number {
  const amount = toMoney(value);
  const converted = amount.toNumber();
  if (!toMoney(String(converted)).equals(amount)) {
    throw new InternalError(
      'EXPORT_MONEY_INEXACT',
      'An amount did not survive conversion to a spreadsheet number',
    );
  }
  return converted;
}

const TIMESTAMP = new Intl.DateTimeFormat('en-IN', {
  timeZone: BUSINESS_TIME_ZONE,
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
});

/**
 * An instant in the business time zone, `19 Sept 2026, 2:05 pm` — display
 * only, as the console's `formatTimestamp`; a business date is still decided
 * by `toBusinessDate` alone (BR-12).
 */
export function formatInstant(instant: string | Date): string {
  return TIMESTAMP.format(
    typeof instant === 'string' ? new Date(instant) : instant,
  );
}
