import { reportRange } from './report-range.js';

/** 10:00 IST on a business date. */
const at = (date: string, time = '10:00:00') =>
  new Date(`${date}T${time}+05:30`);

describe('reportRange (M12)', () => {
  it('defaults to the current month up to today', () => {
    expect(reportRange({}, at('2026-01-17'))).toEqual({
      from: '2026-01-01',
      to: '2026-01-17',
    });
    // On the first of the month the default is that one day.
    expect(reportRange({}, at('2026-02-01'))).toEqual({
      from: '2026-02-01',
      to: '2026-02-01',
    });
  });

  it('starts a blank "from" on the first of the chosen month', () => {
    expect(reportRange({ to: '2025-12-20' }, at('2026-01-17'))).toEqual({
      from: '2025-12-01',
      to: '2025-12-20',
    });
  });

  it('reads today in IST, not UTC (BR-12)', () => {
    // 00:30 IST on 1 February is still 31 January in UTC.
    expect(reportRange({}, at('2026-02-01', '00:30:00')).to).toBe('2026-02-01');
  });

  it('accepts one day and exactly 93 days, and refuses 94', () => {
    expect(
      reportRange({ from: '2026-01-05', to: '2026-01-05' }, at('2026-06-01')),
    ).toEqual({ from: '2026-01-05', to: '2026-01-05' });
    // 1 January to 3 April 2026 is 93 days inclusive.
    expect(
      reportRange({ from: '2026-01-01', to: '2026-04-03' }, at('2026-06-01')),
    ).toEqual({ from: '2026-01-01', to: '2026-04-03' });
    expect(() =>
      reportRange({ from: '2026-01-01', to: '2026-04-04' }, at('2026-06-01')),
    ).toThrow(
      expect.objectContaining({
        code: 'INVALID_DATE_RANGE',
        status: 400,
        details: [expect.objectContaining({ field: 'to' })],
      }),
    );
  });

  it('refuses "from" after "to" at "from"', () => {
    expect(() =>
      reportRange({ from: '2026-01-06', to: '2026-01-05' }, at('2026-06-01')),
    ).toThrow(
      expect.objectContaining({
        code: 'INVALID_DATE_RANGE',
        details: [expect.objectContaining({ field: 'from' })],
      }),
    );
  });

  it('refuses a "to" after today, and allows today', () => {
    expect(() =>
      reportRange({ to: '2026-01-18' }, at('2026-01-17', '23:59:00')),
    ).toThrow(expect.objectContaining({ code: 'DATE_IN_FUTURE', status: 422 }));
    expect(reportRange({ to: '2026-01-17' }, at('2026-01-17')).to).toBe(
      '2026-01-17',
    );
  });
});
