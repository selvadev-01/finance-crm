import { toMoney } from '@repo/domain';

import {
  assertCell,
  excelNumber,
  formatCount,
  formatMoney,
} from '../../src/exports/export-cells.js';

/** M12 export: how a cell is checked and written, before any file exists. */
describe('export cells (M12)', () => {
  it('draws money with Indian grouping and two places, from the string alone', () => {
    expect(formatMoney('0')).toBe('0.00');
    expect(formatMoney('333.3')).toBe('333.30');
    expect(formatMoney('1234567.5')).toBe('12,34,567.50');
    expect(formatMoney('-1500')).toBe('-1,500.00');
    expect(formatMoney('999999999999.99')).toBe('9,99,99,99,99,999.99');
  });

  it('groups counts as money is, without places', () => {
    expect(formatCount(0)).toBe('0');
    expect(formatCount(125000)).toBe('1,25,000');
  });

  it('gives Excel the exact amount for every NUMERIC(14,2) value it is handed', () => {
    for (const value of [
      '0.10',
      '0.20',
      '333.33',
      '-0.01',
      '999999999999.99',
      '-999999999999.99',
      '123456789012.34',
    ]) {
      // What Excel will print back is the amount itself, to the paisa.
      expect(toMoney(String(excelNumber(value))).equals(toMoney(value))).toBe(
        true,
      );
    }
  });

  it('refuses an amount NUMERIC(14,2) could not hold, rather than rounding it', () => {
    expect(() => excelNumber('1.005')).toThrow();
    expect(() => excelNumber('1000000000000.00')).toThrow();
  });

  it('refuses a cell that does not hold what its column says', () => {
    expect(() => assertCell('money', 100)).toThrow(/export cell of kind/);
    expect(() => assertCell('money', '1.234')).toThrow(/export cell of kind/);
    expect(() => assertCell('count', '3')).toThrow(/export cell of kind/);
    expect(() => assertCell('count', 1.5)).toThrow(/export cell of kind/);
    expect(() => assertCell('date', '19-09-2026')).toThrow(
      /export cell of kind/,
    );
    expect(() => assertCell('text', 3)).toThrow(/export cell of kind/);
  });

  it('accepts null (unknown) and an empty string (nothing) in a column of any kind', () => {
    for (const kind of ['money', 'count', 'date', 'text'] as const) {
      expect(() => assertCell(kind, null)).not.toThrow();
      expect(() => assertCell(kind, '')).not.toThrow();
    }
  });
});
